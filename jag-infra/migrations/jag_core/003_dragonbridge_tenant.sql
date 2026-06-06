-- DragonBridge tenant. Owned by Robert (Owner role sees all tenants — no explicit role row needed).
-- STD-13: all new rows, no existing tables modified.

INSERT INTO tenants (id, code, name, is_active)
VALUES (
  '00000000-0000-0000-0001-000000000008',
  'DRAGONBRIDGE',
  'DragonBridge',
  true
)
ON CONFLICT (code) DO NOTHING;
