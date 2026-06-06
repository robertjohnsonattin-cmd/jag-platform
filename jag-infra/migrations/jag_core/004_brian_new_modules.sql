-- Add DRAGONBRIDGE and ENTERTAINMENT to Brian's module permissions.
-- Both default to NONE — Robert grants access via PATCH /api/v1/brian/permissions/:module.

INSERT INTO brian_module_permissions (module, access_level) VALUES
  ('DRAGONBRIDGE',  'NONE'),
  ('ENTERTAINMENT', 'NONE')
ON CONFLICT (module) DO NOTHING;
