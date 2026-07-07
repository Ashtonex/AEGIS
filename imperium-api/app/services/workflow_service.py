from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.workflow import Workflow, ApprovalChain
import logging

class WorkflowService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def initiate_approval(self, workflow_name: str, target_type: str, target_id: str):
        # 1. Fetch Workflow definition
        query = select(Workflow).where(Workflow.name == workflow_name)
        result = await self.db.execute(query)
        workflow = result.scalar_one_or_none()
        
        if not workflow:
            raise ValueError(f"Workflow {workflow_name} not found")
            
        # 2. Create ApprovalChain entry
        chain = ApprovalChain(
            workflow_id=workflow.id,
            target_type=target_type,
            target_id=target_id,
            status="pending",
            current_step=0
        )
        self.db.add(chain)
        await self.db.commit()
        await self.db.refresh(chain)
        
        # 3. Publish Event (e.g. to Redis) to notify approvers
        logging.info(f"Approval chain {chain.id} initiated for {target_type} {target_id}")
        return chain
