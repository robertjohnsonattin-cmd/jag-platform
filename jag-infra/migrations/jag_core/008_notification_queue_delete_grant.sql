-- notification_queue was created after the bulk `GRANT ... ON ALL TABLES IN
-- SCHEMA public TO jag_app` in 000_initial_schema.sql (which only covers
-- tables that existed at the time it ran), and was later manually granted
-- SELECT/INSERT/UPDATE but not DELETE. This left the notification-delete
-- endpoint (DELETE /api/v1/notifications/:id) permanently broken in
-- production with "permission denied for table notification_queue" —
-- discovered 2026-07-13 while testing the notification bell's delete button.

GRANT DELETE ON notification_queue TO jag_app;
