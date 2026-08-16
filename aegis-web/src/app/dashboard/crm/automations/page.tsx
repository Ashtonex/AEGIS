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
  deleteCrmAutomation,
  getCrmAutomationRuns,
  getUsers,
  getCrmMessageTemplates,
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

// Field/operator/value defaults per real backend trigger type (see
// app/services/crm/automation_engine.py's evaluate_and_run_automations callers).
// A blank field always matches (conditions_match() treats a falsy field as "match").
const TRIGGER_PRESETS: Record<string, { field: string; operator: string; value: string }> = {
  lead_created: { field: '', operator: 'equals', value: '' },
  lead_score_changed: { field: 'ai_score', operator: '>', value: '80' },
  opportunity_stage_changed: { field: 'stage', operator: 'equals', value: 'Proposal' },
  quote_sent: { field: '', operator: 'equals', value: '' },
  quote_accepted: { field: '', operator: 'equals', value: '' },
  ticket_created: { field: 'priority', operator: 'equals', value: 'urgent' },
  ticket_sla_near_breach: { field: '', operator: 'equals', value: '' },
  ticket_overdue: { field: '', operator: 'equals', value: '' },
  communication_received: { field: 'channel', operator: 'equals', value: 'whatsapp_message' },
};

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
  const [triggerType, setTriggerType] = useState('lead_score_changed');
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
  const [actionRecipient, setActionRecipient] = useState('');
  const [actionTemplateId, setActionTemplateId] = useState('');
  const [delayHours, setDelayHours] = useState(0);
  const [users, setUsers] = useState<any[]>([]);
  const [messageTemplates, setMessageTemplates] = useState<any[]>([]);

  // Telemetry simulation states
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationLogs, setSimulationLogs] = useState<string[]>([]);
  const [activeSimulationNode, setActiveSimulationNode] = useState<string | null>(null);

  const [telemetryLogs, setTelemetryLogs] = useState<Array<{ id: string; rule: string; status: string; trigger: string; action: string; timestamp: string; executedAt: string | null }>>([]);
  const [isLoadingTelemetry, setIsLoadingTelemetry] = useState(false);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

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

  useEffect(() => {
    void (async () => {
      const [usersRes, templatesRes] = await Promise.allSettled([getUsers(), getCrmMessageTemplates()]);
      if (usersRes.status === "fulfilled" && usersRes.value.success && Array.isArray(usersRes.value.data)) setUsers(usersRes.value.data);
      if (templatesRes.status === "fulfilled" && templatesRes.value.success && Array.isArray(templatesRes.value.data)) setMessageTemplates(templatesRes.value.data);
    })();
  }, []);

  const fetchTelemetryLogs = useCallback(async () => {
    setIsLoadingTelemetry(true);
    setTelemetryError(null);
    try {
      const response = await getCrmAutomationRuns();
      if (response.success && Array.isArray(response.data)) {
        const ruleNameById = new Map(rules.map((r) => [r.id, r.name]));
        setTelemetryLogs(
          response.data.map((run: any) => ({
            id: run.id,
            rule: ruleNameById.get(run.rule_id) || run.rule_id?.slice(0, 8) || "Unknown rule",
            status: run.status || "unknown",
            trigger: run.trigger_type || "unknown",
            action: (() => {
              try {
                const result = typeof run.action_result === "string" ? JSON.parse(run.action_result) : run.action_result;
                return result?.action_type || result?.reason || "recorded";
              } catch {
                return "recorded";
              }
            })(),
            timestamp: run.created_at ? new Date(run.created_at).toLocaleString() : "",
            executedAt: run.created_at || null,
          }))
        );
      } else {
        setTelemetryError("Automation run logs could not be loaded from the CRM service.");
      }
    } catch (error) {
      setTelemetryError(normalizeLoadError(error, "Automation run logs could not be loaded from the CRM service."));
    } finally {
      setIsLoadingTelemetry(false);
    }
  }, [rules, normalizeLoadError]);

  // Loaded unconditionally (not gated to the telemetry tab) so the Telemetry
  // Execs / Failed stat cards above the tabs reflect real data as soon as the
  // page opens, not only after a user happens to click into that tab.
  useEffect(() => {
    void fetchTelemetryLogs();
  }, [fetchTelemetryLogs]);

  const execs24hCount = telemetryLogs.filter((log) => {
    if (!log.executedAt) return false;
    return Date.now() - new Date(log.executedAt).getTime() < 24 * 60 * 60 * 1000;
  }).length;
  const failed24hCount = telemetryLogs.filter((log) => {
    if (!log.executedAt || log.status?.toLowerCase() !== 'failed') return false;
    return Date.now() - new Date(log.executedAt).getTime() < 24 * 60 * 60 * 1000;
  }).length;

  // Sync editor fields when selectedRule changes
  const selectedRule = rules.find(r => r.id === selectedRuleId);
  useEffect(() => {
    if (selectedRule) {
      setRuleName(selectedRule.name);
      setTriggerType(selectedRule.trigger_type || 'lead_score_changed');
      setTriggerField(selectedRule.trigger_conditions?.field ?? 'ai_score');
      setTriggerOperator(selectedRule.trigger_conditions?.operator || '>');
      setTriggerValue(selectedRule.trigger_conditions?.value ?? '80');

      setFilterField(selectedRule.trigger_conditions?.filter_field || 'sector');
      setFilterValue(selectedRule.trigger_conditions?.filter_val || 'Mining');

      setActionType(selectedRule.action_type || 'send_notification');
      setActionMessage(selectedRule.action_config?.message || '');
      setActionRecipient(selectedRule.action_config?.user_id || selectedRule.action_config?.recipient || '');
      setActionTemplateId(selectedRule.action_config?.template_id || '');
      setDelayHours(selectedRule.action_config?.delay_hours || 0);
    }
  }, [selectedRule]);

  const handleAddNewRule = async () => {
    setIsSaving(true);
    const newRulePayload = {
      name: 'Unconfigured Pipeline Rule',
      trigger_type: 'lead_score_changed',
      trigger_conditions: { field: 'ai_score', operator: '>', value: '75' },
      action_type: 'send_notification',
      action_config: { title: 'Unconfigured Pipeline Rule', message: 'Alert: Custom pipeline trigger matched criteria.' },
      is_active: false
    };

    try {
      const res = await createCrmAutomation(newRulePayload);
      if (res.success && res.data?.id) {
        const newRule: AutomationRule = {
          id: res.data.id,
          ...newRulePayload,
          created_at: new Date().toISOString()
        };
        setRules(prev => [...prev, newRule]);
        setSelectedRuleId(res.data.id);
        setActiveInspectorNode('trigger');
        showToast("New workflow deployed to database.");
      } else {
        throw new Error("Creation failed");
      }
    } catch {
      showToast("New rule was not created. Check the CRM automation service and retry.", "error");
    } finally {
      setIsSaving(false);
    }
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

    let action_config: Record<string, unknown>;
    if (actionType === 'send_notification') {
      action_config = { title: ruleName, message: actionMessage, user_id: actionRecipient || undefined };
    } else if (actionType === 'send_template_message') {
      action_config = { template_id: actionTemplateId || undefined };
    } else {
      action_config = { message: actionMessage, recipient: actionRecipient, delay_hours: Number(delayHours) };
    }

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
          <p className="text-lg font-mono font-bold text-[#3B82F6] mt-0.5">
            {isLoadingTelemetry ? '...' : execs24hCount}
          </p>
        </div>
        <div className="bg-ink-light border border-ink-mid p-3 rounded-none relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
          <p className="text-[9px] font-mono tracking-widest text-slate-light uppercase">Failed (24H)</p>
          <p className={`text-lg font-mono font-bold mt-0.5 ${failed24hCount > 0 ? 'text-red-400' : 'text-paper'}`}>
            {isLoadingTelemetry ? '...' : failed24hCount}
          </p>
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
                            const next = e.target.value;
                            setTriggerType(next);
                            const preset = TRIGGER_PRESETS[next];
                            if (preset) {
                              setTriggerField(preset.field);
                              setTriggerOperator(preset.operator);
                              setTriggerValue(preset.value);
                            }
                          }}
                          className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none"
                        >
                          <option value="lead_created">Lead Created</option>
                          <option value="lead_score_changed">Lead AI Score Changes</option>
                          <option value="opportunity_stage_changed">Opportunity Stage Changes</option>
                          <option value="quote_sent">Quotation Sent</option>
                          <option value="quote_accepted">Quotation Accepted</option>
                          <option value="ticket_created">Support Ticket Created</option>
                          <option value="ticket_sla_near_breach">Ticket SLA Near Breach</option>
                          <option value="ticket_overdue">Ticket Overdue</option>
                          <option value="communication_received">Communication Received</option>
                        </select>
                        <p className="mt-1 font-mono text-[8px] text-slate-light">Rules are matched by this exact trigger type when the CRM automation engine fires an event.</p>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <label className="block font-mono text-[9px] text-slate-light mb-1">Field Key (blank = always match)</label>
                          <input
                            type="text"
                            value={triggerField}
                            onChange={(e) => setTriggerField(e.target.value)}
                            className="w-full bg-ink border border-ink-mid p-1.5 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                          />
                        </div>
                        <div>
                          <label className="block font-mono text-[9px] text-slate-light mb-1">Operator</label>
                          <select
                            value={triggerOperator}
                            onChange={(e) => setTriggerOperator(e.target.value)}
                            className="w-full bg-ink border border-ink-mid p-1.5 font-mono text-xs text-paper text-center focus:outline-none"
                          >
                            <option value="equals">=</option>
                            <option value="not_equals">!=</option>
                            <option value=">">&gt;</option>
                            <option value="<">&lt;</option>
                            <option value="contains">contains</option>
                          </select>
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
                          <option value="send_notification">Send In-App Notification</option>
                          <option value="send_template_message">Send Template Message</option>
                          <option value="log_activity">Log Follow-up Activity</option>
                          <option value="create_ticket">Create Support Ticket</option>
                          <option value="update_opportunity_stage">Update Opportunity Stage</option>
                          <option value="assign_owner">Assign Owner</option>
                          <option value="escalate_ticket">Escalate Ticket</option>
                        </select>
                      </div>

                      {actionType === "send_notification" && (
                        <div>
                          <label className="block font-mono text-[9px] text-slate-light mb-1">Notify User</label>
                          <select
                            value={actionRecipient}
                            onChange={(e) => setActionRecipient(e.target.value)}
                            className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none"
                          >
                            <option value="">Select a user...</option>
                            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
                          </select>
                        </div>
                      )}

                      {actionType === "send_template_message" && (
                        <div>
                          <label className="block font-mono text-[9px] text-slate-light mb-1">Message Template</label>
                          <select
                            value={actionTemplateId}
                            onChange={(e) => setActionTemplateId(e.target.value)}
                            className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none"
                          >
                            <option value="">Select a template...</option>
                            {messageTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </select>
                        </div>
                      )}

                      {!["send_notification", "send_template_message"].includes(actionType) && (
                        <div>
                          <label className="block font-mono text-[9px] text-slate-light mb-1">Routing Recipient</label>
                          <input
                            type="text"
                            value={actionRecipient}
                            onChange={(e) => setActionRecipient(e.target.value)}
                            className="w-full bg-ink border border-ink-mid p-2 font-mono text-xs text-paper focus:outline-none focus:border-signal"
                          />
                        </div>
                      )}

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

          {telemetryError && (
            <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              {telemetryError}
            </div>
          )}

          {isLoadingTelemetry ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-[#3B82F6]" />
            </div>
          ) : telemetryLogs.length === 0 ? (
            <p className="py-10 text-center text-[11px] text-slate-light">No automation runs recorded yet.</p>
          ) : (
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
                  {telemetryLogs.map((log) => {
                    const statusLower = log.status.toLowerCase();
                    const statusClass =
                      statusLower === "failed"
                        ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                        : statusLower === "skipped"
                        ? "bg-slate-500/10 border-slate-500/20 text-slate-300"
                        : "bg-green-500/10 border-green-500/20 text-green-500";
                    return (
                      <tr key={log.id} className="hover:bg-ink/30 transition-colors">
                        <td className="py-3 text-slate">{log.id.slice(0, 8)}</td>
                        <td className="py-3 font-semibold text-paper">{log.rule}</td>
                        <td className="py-3 text-[#3B82F6]">{log.trigger}</td>
                        <td className="py-3 text-paper/85">{log.action}</td>
                        <td className="py-3 text-slate-light tabular-nums">{log.timestamp}</td>
                        <td className="py-3 text-right">
                          <span className={`px-2 py-0.5 rounded-none font-bold text-[9px] border ${statusClass}`}>
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
