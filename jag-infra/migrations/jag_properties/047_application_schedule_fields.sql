-- Migration 047: Additional Enter Once fields for the tenancy application so
-- Schedule B (Tenant Information, formerly Schedule C) can be fully pre-filled
-- at lease-signing time instead of asking the tenant to retype data they
-- already gave on their application. Mirrors emergency_contact_name/phone
-- which already exist on prop_property_tenants (from an earlier feature).

ALTER TABLE prop_applications ADD COLUMN nationality VARCHAR(100);
ALTER TABLE prop_applications ADD COLUMN permanent_address TEXT;
ALTER TABLE prop_applications ADD COLUMN occupation VARCHAR(200);
ALTER TABLE prop_applications ADD COLUMN work_address TEXT;
ALTER TABLE prop_applications ADD COLUMN work_telephone VARCHAR(30);
ALTER TABLE prop_applications ADD COLUMN whatsapp_alt VARCHAR(30);
ALTER TABLE prop_applications ADD COLUMN occupants_count INTEGER;
ALTER TABLE prop_applications ADD COLUMN occupants_detail TEXT;
ALTER TABLE prop_applications ADD COLUMN emergency_contact_name VARCHAR(200);
ALTER TABLE prop_applications ADD COLUMN emergency_contact_phone VARCHAR(30);
ALTER TABLE prop_applications ADD COLUMN emergency_contact_relation VARCHAR(100);

ALTER TABLE prop_property_tenants ADD COLUMN nationality VARCHAR(100);
ALTER TABLE prop_property_tenants ADD COLUMN permanent_address TEXT;
ALTER TABLE prop_property_tenants ADD COLUMN occupation VARCHAR(200);
ALTER TABLE prop_property_tenants ADD COLUMN work_address TEXT;
ALTER TABLE prop_property_tenants ADD COLUMN work_telephone VARCHAR(30);
ALTER TABLE prop_property_tenants ADD COLUMN whatsapp_alt VARCHAR(30);
ALTER TABLE prop_property_tenants ADD COLUMN occupants_count INTEGER;
ALTER TABLE prop_property_tenants ADD COLUMN occupants_detail TEXT;
ALTER TABLE prop_property_tenants ADD COLUMN emergency_contact_relation VARCHAR(100);
