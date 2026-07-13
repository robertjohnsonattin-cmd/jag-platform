-- Migration 049: Second emergency contact, mirroring the first one added in
-- migration 047 (both prop_applications and prop_property_tenants).

ALTER TABLE prop_applications ADD COLUMN emergency_contact_2_name VARCHAR(200);
ALTER TABLE prop_applications ADD COLUMN emergency_contact_2_phone VARCHAR(30);
ALTER TABLE prop_applications ADD COLUMN emergency_contact_2_relation VARCHAR(100);

ALTER TABLE prop_property_tenants ADD COLUMN emergency_contact_2_name VARCHAR(200);
ALTER TABLE prop_property_tenants ADD COLUMN emergency_contact_2_phone VARCHAR(30);
ALTER TABLE prop_property_tenants ADD COLUMN emergency_contact_2_relation VARCHAR(100);
