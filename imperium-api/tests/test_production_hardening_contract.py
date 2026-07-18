from pathlib import Path
import unittest

from pydantic import ValidationError

from core.config import Settings


ROOT = Path(__file__).resolve().parents[2]
RENDER_BLUEPRINT = (ROOT / "render.yaml").read_text(encoding="utf-8")
MAIN = (ROOT / "imperium-api" / "main.py").read_text(encoding="utf-8")


def production_settings(**overrides):
    values = {
        "ENVIRONMENT": "production",
        "DEBUG": False,
        "SECRET_KEY": "s" * 48,
        "ALLOWED_ORIGINS": "https://aegis.example.com",
        "ALLOWED_HOSTS": "api.aegis.example.com",
        "DATABASE_URL": "postgresql+asyncpg://user:pass@db.example.com:5432/aegis",
        "SUPABASE_URL": "https://project-ref.supabase.co",
        "SUPABASE_ANON_KEY": "a" * 48,
        "SUPABASE_SERVICE_KEY": "b" * 48,
        "JWT_SECRET_KEY": "j" * 48,
        "REDIS_URL": "rediss://default:pass@redis.example.com:6379/0",
    }
    values.update(overrides)
    return Settings(**values)


class ProductionHardeningContractTests(unittest.TestCase):
    def test_production_settings_accept_explicit_secure_values(self):
        settings = production_settings()

        self.assertEqual(settings.cors_origins, ["https://aegis.example.com"])
        self.assertEqual(settings.allowed_hosts, ["api.aegis.example.com"])

    def test_database_url_normalizes_hosted_postgres_url_to_asyncpg(self):
        settings = production_settings(
            DATABASE_URL="postgresql://user:pass@db.example.com:5432/aegis"
        )

        self.assertEqual(
            settings.DATABASE_URL,
            "postgresql+asyncpg://user:pass@db.example.com:5432/aegis",
        )

    def test_production_rejects_debug_wildcard_cors_and_local_redis(self):
        unsafe_overrides = [
            {"DEBUG": True},
            {"ALLOWED_ORIGINS": "*"},
            {"ALLOWED_ORIGINS": "http://aegis.example.com"},
            {"ALLOWED_HOSTS": "*"},
            {"REDIS_URL": "redis://redis:6379/0"},
        ]

        for override in unsafe_overrides:
            with self.subTest(override=override):
                with self.assertRaises(ValidationError):
                    production_settings(**override)

    def test_production_rejects_placeholder_or_short_secrets(self):
        unsafe_overrides = [
            {"SECRET_KEY": "your-super-secret-jwt-key"},
            {"SUPABASE_ANON_KEY": "[YOUR-ANON-KEY]"},
            {"SUPABASE_SERVICE_KEY": "short"},
            {"JWT_SECRET_KEY": "placeholder"},
        ]

        for override in unsafe_overrides:
            with self.subTest(override=override):
                with self.assertRaises(ValidationError):
                    production_settings(**override)

    def test_render_blueprint_requires_runtime_managed_production_secrets(self):
        self.assertIn("key: ALLOWED_ORIGINS\n        sync: false", RENDER_BLUEPRINT)
        self.assertIn("key: ALLOWED_HOSTS\n        sync: false", RENDER_BLUEPRINT)
        self.assertIn("key: REDIS_URL\n        sync: false", RENDER_BLUEPRINT)
        self.assertIn("key: JWT_SECRET_KEY\n        sync: false", RENDER_BLUEPRINT)
        self.assertNotIn("value: '*'", RENDER_BLUEPRINT)

    def test_app_uses_trusted_host_middleware(self):
        self.assertIn("TrustedHostMiddleware", MAIN)
        self.assertIn("allowed_hosts=settings.allowed_hosts", MAIN)


if __name__ == "__main__":
    unittest.main()
