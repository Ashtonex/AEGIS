"""PRAZ e-GP tender discovery and intake.

portal.py    - the only code that talks to the portal (one allowed host,
               paced, bounded retries, no credentials)
parser.py    - pure HTML -> structured fields with provenance
matching.py  - transparent relevance score and bid-readiness
discovery.py - a resumable, checkpointed discovery run
intake.py    - review, import into crm.tenders, recheck and change history
"""
