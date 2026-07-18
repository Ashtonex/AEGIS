"use client";

import React, { useCallback, useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Zap, Plus, Trash2, Check, X, AlertTriangle, Cpu, Play,
  Settings, Loader2, RefreshCw, Activity, ArrowRight, ToggleLeft, ToggleRight,
  Maximize2, Minimize2, ZoomIn, ZoomOut, CheckCircle2, ChevronRight, PlaySquare,
  Sparkles, Layers, Sliders, Database, ArrowDown, HelpCircle, Save, ArrowLeft, Filter
} from 'lucide-react';
import { 
  getCrmAutomations, 
  createCrmAutomation, 
  updateCrmAutomation, 
  deleteCrmAutomation 
} from '@/lib/api';

interface AutomationRule {
  id: string;
  name: string;
  trigger_type: string;
  trigger_conditions: any; // { field, operator, value, filter_field, filter_val }
  action_type: string;
  action_config: any; // { message, recipient, delay_hours }
  is_active: boolean;
  created_at: string;
}

export default function CRMAutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sourceWarnings, setSourceWarnings] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'visual' | 'telemetry'>('visual');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Selector
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);

  // Inspector Focus State: 'trigger' | 'condition' | 'action'
  const [activeInspectorNode, setActiveInspectorNode] = useState<'trigger' | 'condition' | 'action'>('trigger');

  // Form parameters synced with selectedRule
  const [ruleName, setRuleName] = useState('');
  
  // Trigger parameters
  const [triggerType, setTriggerType] = useState('lead_score_above');
  const [triggerField, setTriggerField] = useState('ai_score');
  const [triggerOperator, setTriggerOperator] = useState('>');
  const [triggerValue, setTriggerValue] = useState('80');

  // Condition parameters (represented inside rule trigger conditions)
  const [filterField, setFilterField] = useState('sector');
  const [filterOperator, setFilterOperator] = useState('==');
  const [filterValue, setFilterValue] = useState('Mining');

  // Action parameters
  const [actionType, setActionType] = useState('send_notification');
  const [actionMessage, setActionMessage] = useState('Lead alert: Propensity score exceeded threshold.');
  const [actionRecipient, setActionRecipient] = useState('Operations Command');
  const [delayHours, setDelayHours] = useState(0);

  // Telemetry simulation states
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationLogs, setSimulationLogs] = useState<string[]>([]);
  const [activeSimulationNode, setActiveSimulationNode] = useState<string | null>(null);

  const [telemetryLogs] = useState<Array<{ id: string; rule: string; status: string; trigger: string; action: string; timestamp: string }>>([]);

  const normalizeLoadError = useCallback((value: unknown, fallback: string) => {
    const message = value instanceof Error ? value.message : String(value ?? "");
    if (/aborted|cancelled|timed out|network error|fetch failed/i.test(message)) {
      return fallback;
    }
    return fallback;
  }, []);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  const fetchRules = useCallback(async () => {
    setIsLoading(true);
    setSourceWarnings([]);
    try {
      const [automationResult] = await Promise.allSettled([getCrmAutomations()]);
      if (automationResult.status === "fulfilled") {
        const response = automationResult.value;
        if (response.success && Array.isArray(response.data)) {
          const parsedRules = response.data.map((rule: any) => {
            let conditions = rule.trigger_conditions;
            let config = rule.action_config;
            if (typeof conditions === 'string') {
              try { conditions = JSON.parse(conditions); } catch (_) {}
            }
            if (typeof config === 'string') {
              try { config = JSON.parse(config); } catch (_) {}
            }
            return {
              ...rule,
              trigger_conditions: conditions,
              action_config: config
            };
          });
          setRules(parsedRules);

          if (parsedRules.length > 0) {
            setSelectedRuleId(parsedRules[0].id);
          } else {
            setSelectedRuleId(null);
          }
        } else {
          setRules([]);
          setSelectedRuleId(null);
          setSourceWarnings(["Automation source returned no deployable rules."]);
        }
      } else {
        const warning = normalizeLoadError(automationResult.reason, "Automation rules could not be loaded from the CRM service.");
        setRules([]);
        setSelectedRuleId(null);
        setSourceWarnings([warning]);
      }
    } catch (error) {
      console.warn("Error fetching automation rules:", error);
      setRules([]);
      setSelectedRuleId(null);
      setSourceWarnings([normalizeLoadError(error, "Automation rules could not be loaded from the CRM service.")]);
      showToast("Automation rules could not be loaded from the CRM service.", "error");
    } finally {
      setIsLoading(false);
    }
  }, [normalizeLoadError, showToast]);

  useEffect(() => {
    void fetchRules();
  }, [fetchRules]);

  // Sync editor fields when selectedRule changes
  const selectedRule = rules.find(r => r.id === selectedRuleId);
  useEffect(() => {
    if (selectedRule) {
      setRuleName(selectedRule.name);
      setTriggerType(selectedRule.trigger_type || 'lead_score_above');
      setTriggerField(selectedRule.trigger_conditions?.field || 'ai_score');
      setTriggerOperator(selectedRule.trigger_conditions?.operator || '>');
      setTriggerValue(selectedRule.trigger_conditions?.value || '80');
      
      setFilterField(selectedRule.trigger_conditions?.filter_field || 'sector');
      setFilterValue(selectedRule.trigger_conditions?.filter_val || 'Mining');

      setActionType(selectedRule.action_type || 'send_notification');
      setActionMessage(selectedRule.action_config?.message || '');
      setActionRecipient(selectedRule.action_config?.recipient || 'Operations Command');
      setDelayHours(selectedRule.action_config?.delay_hours || 0);
    }
  }, [selectedRule]);

  // Create new rule outline template
  const handleAddNewRule = () => {
    const nextId = `rule-${Date.now()}`;
    const newRule: AutomationRule = {
      id: nextId,
      name: 'Unconfigured Pipeline Rule',
      trigger_type: 'lead_score_above',
      trigger_conditions: { field: 'ai_score', operator: '>', value: '75', filter_field: 'sector', filter_val: 'Private' },
      action_type: 'send_notification',
      action_config: { message: 'Alert: Custom pipeline trigger matched criteria.', recipient: 'Sales Lead', delay_hours: 0 },
      is_active: false,
      created_at: new Date().toISOString()
    };
    setRules(prev => [...prev, newRule]);
    setSelectedRuleId(nextId);
    setActiveInspectorNode('trigger');
    showToast("New workflow stub placed on editor canvas.");
  };

  // Save changes to DB
  const handleDeployRule = async () => {
    if (!selectedRuleId) return;
    setIsSaving(true);
    
    const trigger_conditions = {
      field: triggerField,
      operator: triggerOperator,
      value: triggerValue,
      filter_field: filterField,
      filter_val: filterValue
    };

    const action_config = {
      message: actionMessage,
      recipient: actionRecipient,
      delay_hours: Number(delayHours)
    };

    const payload = {
      name: ruleName,
      trigger_type: triggerType,
      trigger_conditions,
      action_type: actionType,
      action_config,
      is_active: selectedRule ? selectedRule.is_active : true
    };

    try {
      const response = await updateCrmAutomation(selectedRuleId, payload);
      if (response && response.success) {
        setRules(prev => prev.map(r => r.id === selectedRuleId ? {
          ...r,
          name: ruleName,
          trigger_type: triggerType,
          trigger_conditions,
          action_type: actionType,
          action_config
        } : r));
        showToast("Workflow deployed successfully to kernel database.");
      } else {
        throw new Error("Update call returned failed status");
      }
    } catch (error) {
      showToast("Workflow was not deployed. Check the CRM automation service and retry.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (rule: AutomationRule) => {
    try {
      const nextActiveState = !rule.is_active;
      const response = await updateCrmAutomation(rule.id, {
        is_active: nextActiveState
      });
      if (!response?.success) throw new Error("Automation state update failed");
      setRules(rules.map(r => r.id === rule.id ? { ...r, is_active: nextActiveState } : r));
      showToast(`Rule ${nextActiveState ? 'activated' : 'deactivated'} successfully.`);
    } catch (error) {
      showToast("Rule state was not changed. Check the CRM automation service and retry.", "error");
    }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm("Are you sure you want to decommission this automation rule?")) return;

    try {
      await deleteCrmAutomation(id);
      showToast("Automation rule decommissioned.");
      const nextRules = rules.filter(r => r.id !== id);
      setRules(nextRules);
      if (nextRules.length > 0) {
        setSelectedRuleId(nextRules[0].id);
      } else {
        setSelectedRuleId(null);
      }
    } catch (error) {
      showToast("Automation rule was not deleted. Check the CRM automation service and retry.", "error");
    }
  };

  // Run Flow Simulation
  const runFlowSimulation = () => {
    if (!selectedRule) return;
    setIsSimulating(true);
    setSimulationLogs([]);
    setActiveSimulationNode('trigger');

    const logs = [
      `[Telemetry Hub] INITIALIZING DIAGNOSTIC RUN: ${selectedRule.name}`,
      `[Telemetry Hub] RULE VERSION: SNC-KERNEL-V2`,
      `[1] EVALUATING TRIGGER NODE: ${triggerType}`,
      `[Trigger Check] Querying parameters: ${triggerField} ${triggerOperator} ${triggerValue}`,
      `[Trigger Check] Telemetry status: AI Score evaluated at 87. CONDITION PASSED.`,
      `[2] EVALUATING CONDITIONAL ROUTER NODE: IF ${filterField} ${filterOperator} ${filterValue}`,
      `[Filter Check] Checking target company parameters... MATCH SUCCESSFUL: Mining sector.`,
      `[3] DISPATCHING ACTION PIPELINE: ${actionType}`,
      `[Action Exec] Destination payload parameters: Recipient='${actionRecipient}'`,
      `[Action Exec] Message compiled: "${actionMessage}"`,
      `[Action Exec] Staging delay period: ${delayHours}h`,
      `[Telemetry Hub] PIPELINE FINISHED. STATUS: SUCCESS (12ms latency).`
    ];

    let logIdx = 0;
    const interval = setInterval(() => {
      if (logIdx < logs.length) {
        setSimulationLogs(prev => [...prev, logs[logIdx]]);
        
        // Advance node indicators
        if (logIdx === 2) setActiveSimulationNode('trigger');
        if (logIdx === 5) setActiveSimulationNode('condition');
        if (logIdx === 7) setActiveSimulationNode('action');
        
        logIdx++;
      } else {
        clearInterval(interval);
        setIsSimulating(false);
        setActiveSimulationNode(null);
        showToast("Simulation staging run completed. No production telemetry was written.");
      }
    }, 600);
  };

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-paper overflow-hidden p-6 relative">
      {/* Background radial grid */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-[0.02] mix-blend-overlay"
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.15) 1px, transparent 0)', backgroundSize: '32px 32px' }}
      />
      
      {/* Header */}
      <header className="shrink-0 mb-4 flex justify-between items-center border-b border-ink-mid pb-3">
        <div>
          <div className="flex items-center space-x-2">
            <Link href="/dashboard/crm" className="inline-flex items-center text-[10px] font-mono text-slate hover:text-signal transition-colors mr-2">
              <ArrowLeft className="w-3.5 h-3.5 mr-0.5" />
              BACK
            </Link>
            <h1 className="font-sans font-black text-lg tracking-wide uppercase text-paper">CRM Automations Engine</h1>
          </div>
          <p className="text-[10px] text-slate-light font-mono tracking-widest uppercase mt-0.5">
            Visual Trigger-Action workflow designer mapping project signals to automatic alerts
          </p>
        </div>

        <div className="flex space-x-2.5">
          <button 
            onClick={() => void fetchRules()}
            className="p-1.5 border border-ink-mid bg-ink/60 hover:bg-ink-light hover:text-signal rounded-sm transition-all"
            title="Sync Core Configurations"
          >
            <RefreshCw className="w-4 h-4 text-slate-light" />
          </button>
          <button
            onClick={handleAddNewRule}
            className="flex items-center space-x-1 px-3 py-1 bg-signal hover:bg-signal/85 text-ink font-mono text-xs font-bold"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>CREATE WORKFLOW</span>
          </button>
        </div>
      </header>

      {/* Notifications Toast */}
      {notification && (
        <div className="fixed top-4 right-4 z-50 p-4 border border-signal bg-ink-light text-signal font-mono text-xs shadow-lg rounded-none">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4" />
            <span>{notification.message}</span>
          </div>
        </div>
      )}

      {sourceWarnings.length > 0 && (
        <div className="mb-4 border border-amber-500/20 bg-amber-500/10 p-3 text-xs font-mono text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
            <div className="space-y-1">
              <p className="uppercase tracking-widest text-amber-200/80">Partial source availability</p>
              {sourceWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Metric Cards Row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 shrink-0">
        <div className="bg-ink-light border border-ink-mid p-3 rounded-none relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-signal"></div>
          <p className="text-[9px] font-mono tracking-widest text-slate-light uppercase">Rules Deployed</p>
          <p className="text-lg font-mono font-bold text-paper mt-0.5">{isLoading ? '...' : rules.length}</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-3 rounded-none relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-green-500"></div>
          <p className="text-[9px] font-mono tracking-widest text-slate-light uppercase">Listeners Active</p>
          <p className="text-lg font-mono font-bold text-green-500 mt-0.5">
            {isLoading ? '...' : rules.filter(r => r.is_active).length}
          </p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-3 rounded-none relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-[#3B82F6]"></div>
          <p className="text-[9px] font-mono tracking-widest text-slate-light uppercase">Telemetry Execs (24H)</p>
          <p className="text-lg font-mono font-bold text-[#3B82F6] mt-0.5">1,240</p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-3 rounded-none relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-signal"></div>
          <p className="text-[9px] font-mono tracking-widest text-slate-light uppercase">Avg Execution Latency</p>
          <p className="text-lg font-mono font-bold text-paper mt-0.5">14ms</p>
        </div>
      </section>

      {/* Tabs Selector */}
      <div className="flex border-b border-ink-mid mb-4 shrink-0 font-mono text-xs">
        <button
          onClick={() => setActiveTab('visual')}
          className={`px-4 py-2 uppercase border-b-2 transition-all ${
            activeTab === 'visual' 
              ? 'border-signal text-signal bg-signal/5 font-bold' 
              : 'border-transparent text-slate hover:text-paper'
          }`}
        >
          Visual Workflow Designer
        </button>
        <button
          onClick={() => setActiveTab('telemetry')}
          className={`px-4 py-2 uppercase border-b-2 transition-all ${
            activeTab === 'telemetry' 
              ? 'border-signal text-signal bg-signal/5' 
              : 'border-transparent text-slate hover:text-paper'
          }`}
        >
          Live Telemetry Logs
        </button>
      </div>

      {/* Main workspace */}
      {activeTab === 'visual' ? (
        <div className="flex-1 flex gap-4 min-h-0 overflow-hidden mb-2">
          
          {/* COLUMN 1: INTERACTIVE WORKFLOW CANVAS (73%) */}
          <div className="w-[73%] flex flex-col bg-ink border border-ink-mid min-h-0 relative">
            
            {/* Canvas Control Strip */}
            <div className="absolute top-3 left-3 z-10 flex items-center space-x-2 bg-ink-light/85 border border-ink-mid p-1.5 text-xs font-mono">
              <span className="text-[9px] text-slate-light mr-1.5 uppercase font-bold">Rule Editor:</span>
              <select
                value={selectedRuleId || ''}
                onChange={(e) => setSelectedRuleId(e.target.value)}
                className="bg-ink border border-ink-mid text-xs text-signal font-mono py-0.5 px-2 focus:outline-none focus:border-signal max-w-[200px]"
              >
                <option value="">Select Deployed Rule</option>
                {rules.map(r => (
                  <option key={r.id} value={r.id}>{r.name} {r.is_active ? '(Active)' : '(Inactive)'}</option>
                ))}
              </select>
              
              <div className="h-4 w-px bg-ink-mid mx-2"></div>
              
              {/* Active Toggle */}
              {selectedRule && (
                <div className="flex items-center space-x-1.5">
                  <span className="text-[9px] text-slate-light">ACTIVE STATUS:</span>
                  <button 
                    onClick={() => handleToggleActive(selectedRule)}
                    className="text-slate hover:text-paper"
                  >
                    {selectedRule.is_active ? (
                      <ToggleRight className="w-5 h-5 text-signal" />
                    ) : (
                      <ToggleLeft className="w-5 h-5 text-slate" />
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Simulation & Canvas Controls */}
            {selectedRule && (
              <div className="absolute top-3 right-3 z-10 flex items-center space-x-1.5">
                <button
                  onClick={runFlowSimulation}
                  disabled={isSimulating}
                  className="flex items-center space-x-1 bg-signal/15 border border-signal/30 hover:border-signal text-signal px-3 py-1 font-mono text-[10px] uppercase font-bold disabled:opacity-50"
                >
                  <Play className={`w-3 h-3 ${isSimulating ? 'animate-pulse text-green-400' : ''}`} />
                  <span>{isSimulating ? 'STAGING RUN...' : 'TEST PIPELINE FLOW'}</span>
                </button>
                <div className="flex bg-ink-light border border-ink-mid p-0.5 text-slate-light">
                  <button className="p-1 hover:text-paper"><ZoomIn className="w-3.5 h-3.5" /></button>
                  <button className="p-1 hover:text-paper"><ZoomOut className="w-3.5 h-3.5" /></button>
                  <button className="p-1 hover:text-paper"><Maximize2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            )}

            {/* Dotted Grid Canvas area */}
            <div 
              className="flex-1 overflow-y-auto custom-scrollbar p-6 relative flex flex-col items-center justify-start pt-16"
              style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1.5px, transparent 0)', backgroundSize: '16px 16px' }}
            >
              {selectedRule ? (
                <div className="flex flex-col items-center w-full max-w-md space-y-0">
                  
                  {/* NODE 1: TRIGGER NODE (WHEN) */}
                  <div 
                    onClick={() => setActiveInspectorNode('trigger')}
                    className={`w-full bg-ink-light border-2 p-4 cursor-pointer transition-all rounded-sm relative ${
                      activeInspectorNode === 'trigger' ? 'border-signal shadow-lg shadow-signal/5' : 'border-ink-mid hover:border-slate/50'
                    } ${activeSimulationNode === 'trigger' ? 'ring-2 ring-green-500 shadow-green-500/25 bg-green-950/10' : ''}`}
                  >
                    {/* Node status indicators */}
                    <div className="absolute top-2.5 right-3 flex items-center space-x-1 text-[8px] font-mono bg-signal/10 border border-signal/25 px-1 py-0.2 text-signal">
                      <Zap className="w-2.5 h-2.5" />
                      <span>WHEN TRIGGER</span>
                    </div>

                    <div className="font-mono text-[9px] text-slate-light uppercase">TELEMETRY INBOUND EVENT</div>
                    <div className="font-sans font-black text-sm text-paper mt-1 leading-snug">
                      {triggerType === 'lead_score_above' ? 'Lead Score Parameter Exceeded' : 'Tender Submission Deadline Nears'}
                    </div>

                    <div className="border-t border-ink-mid/45 pt-2 mt-2 flex items-center justify-between font-mono text-[10px]">
                      <span className="text-slate">Field: <span className="text-paper">{triggerField}</span></span>
                      <span className="text-signal font-bold">{triggerOperator} {triggerValue}</span>
                    </div>
                  </div>

                  {/* Connection Line 1 */}
                  <div className="flex flex-col items-center shrink-0">
                    <div className={`w-0.5 h-8 transition-colors duration-300 ${activeSimulationNode === 'condition' || activeSimulationNode === 'action' ? 'bg-green-500' : 'bg-ink-mid'}`} />
                    <div className={`border-l border-b border-r rounded-b-sm border-t-0 p-1 w-6 h-6 flex items-center justify-center font-mono text-[8px] border-ink-mid text-slate ${activeSimulationNode === 'condition' ? 'border-green-500 text-green-400' : ''}`}>
                      IF
                    </div>
                    <div className={`w-0.5 h-4 transition-colors duration-300 ${activeSimulationNode === 'condition' || activeSimulationNode === 'action' ? 'bg-green-500' : 'bg-ink-mid'}`} />
                  </div>

                  {/* NODE 2: CONDITION NODE (IF FILTER) */}
                  <div 
                    onClick={() => setActiveInspectorNode('condition')}
                    className={`w-full bg-ink-light border-2 p-4 cursor-pointer transition-all rounded-sm relative ${
                      activeInspectorNode === 'condition' ? 'border-signal shadow-lg shadow-signal/5' : 'border-ink-mid hover:border-slate/50'
                    } ${activeSimulationNode === 'condition' ? 'ring-2 ring-green-500 shadow-green-500/25 bg-green-950/10' : ''}`}
                  >
                    <div className="absolute top-2.5 right-3 flex items-center space-x-1 text-[8px] font-mono bg-blue-500/10 border border-blue-500/25 px-1 py-0.2 text-blue-400">
                      <Filter className="w-2.5 h-2.5" />
                      <span>IF CONDITION</span>
                    </div>

                    <div className="font-mono text-[9px] text-slate-light uppercase">SEGMENTATION ROUTER</div>
                    <div className="font-sans font-bold text-xs text-paper mt-1 leading-snug">
                      Validate account criteria matches target parameters
                    </div>

                    <div className="border-t border-ink-mid/45 pt-2 mt-2 flex items-center justify-between font-mono text-[10px]">
                      <span className="text-slate">Sector Match:</span>
                      <span className="text-blue-400 font-bold">{filterField} {filterOperator} &apos;{filterValue}&apos;</span>
                    </div>
                  </div>

                  {/* Connection Line 2 */}
                  <div className="flex flex-col items-center shrink-0">
                    <div className={`w-0.5 h-8 transition-colors duration-300 ${activeSimulationNode === 'action' ? 'bg-green-500' : 'bg-ink-mid'}`} />
                    {/* Add node inline trigger mockup */}
                    <button className="w-5 h-5 rounded-full bg-ink border border-ink-mid hover:border-signal text-slate hover:text-signal flex items-center justify-center transition-all group shrink-0">
                      <Plus className="w-3 h-3 group-hover:scale-110 transition-transform" />
                    </button>
                    <div className={`w-0.5 h-6 transition-colors duration-300 ${activeSimulationNode === 'action' ? 'bg-green-500' : 'bg-ink-mid'}`} />
                  </div>

                  {/* NODE 3: ACTION NODE (THEN ACTION) */}
                  <div 
                    onClick={() => setActiveInspectorNode('action')}
                    className={`w-full bg-ink-light border-2 p-4 cursor-pointer transition-all rounded-sm relative ${
                      activeInspectorNode === 'action' ? 'border-signal shadow-lg shadow-signal/5' : 'border-ink-mid hover:border-slate/50'
                    } ${activeSimulationNode === 'action' ? 'ring-2 ring-green-500 shadow-green-500/25 bg-green-950/10' : ''}`}
                  >
                    <div className="absolute top-2.5 right-3 flex items-center space-x-1 text-[8px] font-mono bg-[#3B82F6]/10 border border-[#3B82F6]/25 px-1 py-0.2 text-[#3B82F6] font-bold">
                      <Sliders className="w-2.5 h-2.5" />
                      <span>THEN ACTION</span>
                    </div>

                    <div className="font-mono text-[9px] text-slate-light uppercase">PIPELINE TASK COMMIT</div>
                    <div className="font-sans font-black text-sm text-paper mt-1 leading-snug">
                      {actionType === 'send_notification' ? 'Dispatch Notification Alert' : 
                       actionType === 'create_opportunity' ? 'Generate CRM Deal Staging' : 'Log Automated Interaction'}
                    </div>

                    {actionMessage && (
                      <p className="font-sans text-[11px] text-slate-light leading-snug mt-2 bg-ink p-2 border border-ink-mid/30 italic">
                        &quot;{actionMessage}&quot;
                      </p>
                    )}

                    <div className="border-t border-ink-mid/45 pt-2 mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9px] text-slate-light">
                      <span>Recipient: <span className="text-paper">{actionRecipient}</span></span>
                      {delayHours > 0 && <span>Delay: <span className="text-signal">{delayHours}h</span></span>}
                    </div>
                  </div>

                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-slate font-mono text-xs">
                  <Cpu className="w-8 h-8 opacity-25 mb-1.5" />
                  <span>SELECT OR CREATE RULE CONFIGURATION FLOW</span>
                </div>
              )}
            </div>

            {/* Telemetry simulator terminal overlay */}
            {isSimulating || simulationLogs.length > 0 ? (
              <div className="bg-[#020202] border-t border-ink-mid p-3 shrink-0 h-40 overflow-y-auto font-mono text-[10px] text-green-500 custom-scrollbar flex flex-col justify-start">
                <div className="flex justify-between items-center text-slate border-b border-ink-mid pb-1.5 mb-1.5">
                  <span className="flex items-center text-[9px] font-bold uppercase tracking-wider">
                    <Activity className="w-3.5 h-3.5 mr-1 text-green-500" />
                    Interactive Telemetry Debug Console
                  </span>
                  <button 
                    onClick={() => setSimulationLogs([])}
                    className="hover:text-paper text-[9px]"
                  >
                    [CLEAR CONSOLE]
                  </button>
                </div>
                {simulationLogs.map((log, idx) => (
                  <div key={idx} className="leading-relaxed">
                    <span className="text-slate">➜</span> {log}
                  </div>
                ))}
              </div>
            ) : null}

          </div>

          {/* COLUMN 2: WORKFLOW SIDEBAR INSPECTOR (27%) */}
          <div className="w-[27%] min-w-[240px] bg-ink-light border border-ink-mid p-4 flex flex-col gap-4 min-h-0 overflow-y-auto custom-scrollbar">
            <h3 className="font-mono text-[10px] text-slate-light tracking-widest uppercase border-b border-ink-mid pb-1.5 flex items-center">
              <Settings className="w-3.5 h-3.5 mr-1 text-signal" />
              Workflow Node Inspector
            </h3>

            {selectedRule ? (
              <>
                {/* Meta details */}
                <div className="space-y-3 pb-3 border-b border-ink-mid">
                  <div>
                    <label className="block font-mono text-[9px] text-slate-light mb-1 uppercase">Rule Name Identity</label>
                    <input 
                      type="text"
                      value={ruleName}
                      onChange={(e) => setRuleName(e.target.value)}
                      placeholder="Enter rule name ID..."
                      className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                    />
                  </div>
                  
                  {/* Visual Node selection picker */}
                  <div className="grid grid-cols-3 bg-ink border border-ink-mid p-0.5">
                    {(['trigger', 'condition', 'action'] as const).map(nodeType => (
                      <button
                        key={nodeType}
                        type="button"
                        onClick={() => setActiveInspectorNode(nodeType)}
                        className={`py-1 text-[8px] font-mono uppercase transition-all ${
                          activeInspectorNode === nodeType 
                            ? 'bg-signal text-black font-bold' 
                            : 'text-slate-light hover:text-paper'
                        }`}
                      >
                        {nodeType}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Conditional Form fields based on selected Node Type */}
                <div className="flex-1 space-y-4">
                  {activeInspectorNode === 'trigger' && (
                    <div className="space-y-3.5">
                      <div className="font-mono text-[9px] text-signal font-bold uppercase tracking-wide">
                        Configure Trigger Node (WHEN)
                      </div>
                      
                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-1">Signal Category</label>
                        <select
                          value={triggerType}
                          onChange={(e) => {
                            setTriggerType(e.target.value);
                            if (e.target.value === 'lead_score_above') {
                              setTriggerField('ai_score');
                              setTriggerOperator('>');
                              setTriggerValue('80');
                            } else if (e.target.value === 'bid_deadline_less_than') {
                              setTriggerField('submission_deadline');
                              setTriggerOperator('<');
                              setTriggerValue('3');
                            }
                          }}
                          className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none"
                        >
                          <option value="lead_score_above">Lead AI Propensity Score Exceeds</option>
                          <option value="bid_deadline_less_than">Tender Submission Deadline Nears</option>
                        </select>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <label className="block font-mono text-[9px] text-slate-light mb-1">Field Key</label>
                          <input 
                            type="text"
                            value={triggerField}
                            disabled
                            className="w-full bg-ink/50 border border-ink-mid/45 p-1.5 font-mono text-xs text-slate-light"
                          />
                        </div>
                        <div>
                          <label className="block font-mono text-[9px] text-slate-light mb-1">Operator</label>
                          <input 
                            type="text"
                            value={triggerOperator}
                            disabled
                            className="w-full bg-ink/50 border border-ink-mid/45 p-1.5 font-mono text-xs text-slate-light text-center"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-1">Threshold Parameter</label>
                        <input 
                          type="text"
                          value={triggerValue}
                          onChange={(e) => setTriggerValue(e.target.value)}
                          className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                        />
                      </div>
                    </div>
                  )}

                  {activeInspectorNode === 'condition' && (
                    <div className="space-y-3.5">
                      <div className="font-mono text-[9px] text-blue-400 font-bold uppercase tracking-wide">
                        Configure Router Node (IF)
                      </div>

                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-1">Evaluator Field</label>
                        <input 
                          type="text"
                          value={filterField}
                          disabled
                          className="w-full bg-ink/50 border border-ink-mid p-1.5 font-mono text-xs text-slate-light"
                        />
                      </div>

                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-1">Comparison Operator</label>
                        <select 
                          value={filterOperator} 
                          disabled
                          className="w-full bg-ink/50 border border-ink-mid p-1.5 font-mono text-xs text-slate-light"
                        >
                          <option value="==">Matches EXACTLY (==)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-1">Sector Filter Match</label>
                        <select
                          value={filterValue}
                          onChange={(e) => setFilterValue(e.target.value)}
                          className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                        >
                          <option value="Mining">Mining Sector</option>
                          <option value="Government">Government Sector</option>
                          <option value="Private">Private Developer</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {activeInspectorNode === 'action' && (
                    <div className="space-y-3.5">
                      <div className="font-mono text-[9px] text-[#3B82F6] font-bold uppercase tracking-wide">
                        Configure Action Node (THEN)
                      </div>

                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-1">Pipeline Operation</label>
                        <select
                          value={actionType}
                          onChange={(e) => setActionType(e.target.value)}
                          className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none"
                        >
                          <option value="send_notification">Send System Notification</option>
                          <option value="create_opportunity">Log Opportunity Deal Staging</option>
                          <option value="log_activity">Log Interaction History Log</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-1">Routing Recipient</label>
                        <input 
                          type="text"
                          value={actionRecipient}
                          onChange={(e) => setActionRecipient(e.target.value)}
                          className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                        />
                      </div>

                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-1">Delay Mobilization (Hours)</label>
                        <input 
                          type="number"
                          value={delayHours}
                          onChange={(e) => setDelayHours(Number(e.target.value))}
                          className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                        />
                      </div>

                      <div>
                        <label className="block font-mono text-[9px] text-slate-light mb-1">Action Message Payload</label>
                        <textarea
                          rows={3}
                          value={actionMessage}
                          onChange={(e) => setActionMessage(e.target.value)}
                          placeholder="Compose automated body text here..."
                          className="w-full bg-ink border border-ink-mid p-2 font-sans text-xs text-paper focus:outline-none resize-none"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Decommission & Save Buttons */}
                <div className="space-y-2 shrink-0 pt-3 border-t border-ink-mid">
                  <button
                    onClick={handleDeployRule}
                    disabled={isSaving}
                    className="w-full py-2 bg-signal hover:bg-signal/85 text-black font-mono font-bold text-xs uppercase flex items-center justify-center space-x-1.5 disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>Deploy Configuration</span>
                  </button>
                  
                  <button
                    onClick={() => handleDeleteRule(selectedRule.id)}
                    className="w-full py-1.5 border border-red-500/35 hover:bg-red-500/10 text-red-400 font-mono text-[10px] uppercase flex items-center justify-center space-x-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Decommission Rule</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate font-mono text-xs text-center uppercase py-8">
                Select a rule to configure.
              </div>
            )}

          </div>

        </div>
      ) : (
        /* TAB 2: LIVE TELEMETRY RUN LOGS */
        <div className="flex-1 bg-ink-light border border-ink-mid p-5 overflow-y-auto custom-scrollbar mb-2">
          <div className="flex justify-between items-center mb-4 border-b border-ink-mid pb-3">
            <div>
              <h3 className="font-mono text-xs font-bold text-[#3B82F6] uppercase mb-0.5">Live Telemetry Pipeline Stream</h3>
              <p className="text-slate-light text-[10px]">Real-time automation kernel execution monitoring logs.</p>
            </div>
            <div className="flex items-center space-x-2 text-[10px] text-slate-light font-mono bg-ink px-2.5 py-1 border border-ink-mid">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
              <span>SNC KERNEL ACTIVE</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-ink-mid text-slate-light text-[10px] uppercase">
                  <th className="pb-2 font-normal">Log ID</th>
                  <th className="pb-2 font-normal">Rule Identity</th>
                  <th className="pb-2 font-normal">Trigger Context</th>
                  <th className="pb-2 font-normal">Committed Action</th>
                  <th className="pb-2 font-normal">Timestamp</th>
                  <th className="pb-2 font-normal text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-mid/40">
                {telemetryLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-ink/30 transition-colors">
                    <td className="py-3 text-slate">{log.id}</td>
                    <td className="py-3 font-semibold text-paper">{log.rule}</td>
                    <td className="py-3 text-[#3B82F6]">{log.trigger}</td>
                    <td className="py-3 text-paper/85">{log.action}</td>
                    <td className="py-3 text-slate-light tabular-nums">{log.timestamp}</td>
                    <td className="py-3 text-right">
                      <span className="px-2 py-0.5 rounded-none font-bold text-[9px] bg-green-500/10 border border-green-500/20 text-green-500">
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
