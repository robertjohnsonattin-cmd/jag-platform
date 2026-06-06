-- JAG Holdings — PostgreSQL bootstrap script
-- Run once on the AMD primary as the postgres superuser:
--   sudo -u postgres psql -f bootstrap.sql
--
-- Creates all roles, databases, and grants.
-- Run BEFORE starting Keycloak or the event dispatcher.

-- ── Roles ─────────────────────────────────────────────────────────────────────

-- Application role (used by all JAG services)
CREATE ROLE jag_app WITH LOGIN PASSWORD 'CHANGE_ME_app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Keycloak role
CREATE ROLE keycloak_user WITH LOGIN PASSWORD 'CHANGE_ME_keycloak_db_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Streaming replication role
CREATE ROLE replicator WITH LOGIN REPLICATION PASSWORD 'CHANGE_ME_replication_password';

-- ── Databases ─────────────────────────────────────────────────────────────────
CREATE DATABASE jag_core          OWNER jag_app ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';
CREATE DATABASE jag_commercial    OWNER jag_app ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';
CREATE DATABASE jag_entertainment OWNER jag_app ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';
CREATE DATABASE jag_family        OWNER jag_app ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';
CREATE DATABASE jag_properties    OWNER jag_app ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';
CREATE DATABASE keycloak          OWNER keycloak_user ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';

-- ── Extensions (must be run per-database) ─────────────────────────────────────
\c jag_core
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgres_fdw;  -- cross-DB queries (STD-02)
GRANT USAGE ON FOREIGN DATA WRAPPER postgres_fdw TO jag_app;

\c jag_commercial
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\c jag_entertainment
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\c jag_family
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\c jag_properties
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Grants ────────────────────────────────────────────────────────────────────
-- jag_app already owns all JAG databases (set as OWNER above).
-- Keycloak user owns the keycloak database.
-- Additional schema-level grants are applied by node-pg-migrate during migration.

-- ── Audit: confirm creation ───────────────────────────────────────────────────
\echo 'Databases created:'
\l jag_core jag_commercial jag_entertainment jag_family jag_properties keycloak

\echo 'Roles created:'
\du jag_app keycloak_user replicator
