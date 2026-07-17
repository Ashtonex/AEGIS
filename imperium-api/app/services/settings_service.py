from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.system import Setting, FeatureFlag


class SettingsService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_setting(self, key: str, default=None):
        query = select(Setting).where(Setting.key == key)
        result = await self.db.execute(query)
        setting = result.scalar_one_or_none()
        return setting.value if setting else default

    async def is_feature_enabled(self, module_name: str) -> bool:
        query = select(FeatureFlag).where(FeatureFlag.module_name == module_name)
        result = await self.db.execute(query)
        flag = result.scalar_one_or_none()

        if not flag:
            return False
        return flag.status == "enabled"
