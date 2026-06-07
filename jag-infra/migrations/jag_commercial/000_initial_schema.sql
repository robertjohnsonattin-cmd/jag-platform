--
-- PostgreSQL database dump
--

\restrict BRFhzEyJiKHuj5mW9U1Cst59DVNBt5hMU3YPmcsetoU38HIHgwHd4ICmloVyIbq

-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: claim_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.claim_status AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'CERTIFIED',
    'PAID',
    'DISPUTED'
);


--
-- Name: db_client_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.db_client_type AS ENUM (
    'B2B',
    'B2C'
);


--
-- Name: db_delivery_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.db_delivery_status AS ENUM (
    'SCHEDULED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'FAILED'
);


--
-- Name: db_invoice_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.db_invoice_status AS ENUM (
    'DRAFT',
    'ISSUED',
    'PAID',
    'VOID'
);


--
-- Name: db_invoice_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.db_invoice_type AS ENUM (
    'DEPOSIT',
    'FINAL',
    'AGENCY_FEE'
);


--
-- Name: db_jag_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.db_jag_role AS ENUM (
    'AGENT',
    'IMPORTER'
);


--
-- Name: db_order_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.db_order_status AS ENUM (
    'CONFIRMED',
    'IN_PRODUCTION',
    'READY_TO_SHIP',
    'IN_TRANSIT',
    'CUSTOMS',
    'DELIVERED',
    'CANCELLED'
);


--
-- Name: db_quote_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.db_quote_status AS ENUM (
    'DRAFT',
    'SENT',
    'ACCEPTED',
    'EXPIRED',
    'CANCELLED'
);


--
-- Name: db_reconciliation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.db_reconciliation_status AS ENUM (
    'PENDING',
    'AUTO_CLOSED',
    'PENDING_REVIEW',
    'APPROVED',
    'INVOICED'
);


--
-- Name: db_shipment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.db_shipment_status AS ENUM (
    'BOOKING',
    'LOADING',
    'IN_TRANSIT',
    'ARRIVED',
    'CLEARED'
);


--
-- Name: ims_vat_code; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ims_vat_code AS ENUM (
    'STANDARD',
    'ZERO',
    'EXEMPT'
);


--
-- Name: item_condition; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.item_condition AS ENUM (
    'NEW',
    'GOOD',
    'FAIR',
    'POOR',
    'WRITTEN_OFF'
);


--
-- Name: jabco_invoice_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.jabco_invoice_status AS ENUM (
    'RECEIVED',
    'APPROVED',
    'PAID'
);


--
-- Name: jabco_vat_code; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.jabco_vat_code AS ENUM (
    'STANDARD',
    'ZERO',
    'EXEMPT'
);


--
-- Name: movement_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.movement_type AS ENUM (
    'RECEIVE',
    'TRANSFER',
    'ADJUSTMENT',
    'CONSUME',
    'RETURN',
    'DISPOSAL',
    'SALE'
);


--
-- Name: nlcb_expense_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.nlcb_expense_status AS ENUM (
    'PENDING',
    'PAID'
);


--
-- Name: nlcb_session_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.nlcb_session_status AS ENUM (
    'OPEN',
    'CLOSED'
);


--
-- Name: nlcb_settlement_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.nlcb_settlement_status AS ENUM (
    'PENDING',
    'PAID'
);


--
-- Name: pipeline_stage; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pipeline_stage AS ENUM (
    'LEAD',
    'QUALIFIED',
    'PROPOSAL',
    'NEGOTIATION',
    'WON',
    'LOST'
);


--
-- Name: project_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.project_status AS ENUM (
    'TENDER',
    'ACTIVE',
    'PRACTICAL_COMPLETION',
    'DEFECTS_LIABILITY',
    'CLOSED',
    'CANCELLED'
);


--
-- Name: retention_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.retention_status AS ENUM (
    'HOLDING',
    'PARTIALLY_RELEASED',
    'FULLY_RELEASED'
);


--
-- Name: sync_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.sync_status AS ENUM (
    'SYNCED',
    'PENDING_SYNC'
);


--
-- Name: vehicle_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vehicle_type AS ENUM (
    'CAR',
    'SUV',
    'TRUCK',
    'VAN',
    'EXCAVATOR',
    'COMPACTOR',
    'ROLLER',
    'CRANE',
    'GENERATOR',
    'TRAILER',
    'MOTORCYCLE',
    'OTHER'
);


--
-- Name: vo_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vo_status AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'WITHDRAWN'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: crm_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying NOT NULL,
    industry character varying,
    country character varying DEFAULT 'TT'::character varying NOT NULL,
    phone character varying,
    email character varying,
    website character varying,
    notes text,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_companies FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE crm_companies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_companies IS 'RLS: tenant_id. Shared master record for JABCO clients, DragonBridge partners, and potential acquisitions.';


--
-- Name: COLUMN crm_companies.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_companies.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: crm_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    company_id uuid,
    first_name character varying NOT NULL,
    last_name character varying NOT NULL,
    email character varying,
    phone character varying,
    role character varying,
    preferred_language character varying(5) DEFAULT 'en'::character varying NOT NULL,
    loyalty_member_id uuid,
    notes text,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_contacts FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE crm_contacts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_contacts IS 'RLS: tenant_id.';


--
-- Name: COLUMN crm_contacts.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_contacts.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN crm_contacts.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_contacts.role IS 'e.g. Project Manager, Procurement Officer, Director';


--
-- Name: COLUMN crm_contacts.loyalty_member_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_contacts.loyalty_member_id IS 'cross-db ref: jag_family.fam_loyalty_programmes.id — JAG Lifestyle integration point (logical reference, no DB-level FK)';


--
-- Name: crm_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_interactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    user_id uuid NOT NULL,
    interaction_type character varying NOT NULL,
    subject character varying NOT NULL,
    notes text,
    occurred_at timestamp with time zone NOT NULL,
    follow_up_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_interactions FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE crm_interactions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_interactions IS 'RLS: tenant_id.';


--
-- Name: COLUMN crm_interactions.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_interactions.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN crm_interactions.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_interactions.user_id IS 'cross-db ref: jag_core.users.id — who logged this';


--
-- Name: COLUMN crm_interactions.interaction_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_interactions.interaction_type IS 'CALL | EMAIL | MEETING | SITE_VISIT | OTHER';


--
-- Name: crm_sales_pipeline; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crm_sales_pipeline (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    contact_id uuid,
    company_id uuid,
    title character varying NOT NULL,
    stage public.pipeline_stage DEFAULT 'LEAD'::public.pipeline_stage NOT NULL,
    estimated_value numeric,
    currency character varying(3) DEFAULT 'TTD'::character varying NOT NULL,
    probability_percent integer,
    expected_close_date date,
    assigned_to uuid NOT NULL,
    notes text,
    idempotency_key uuid NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.crm_sales_pipeline FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE crm_sales_pipeline; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.crm_sales_pipeline IS 'RLS: tenant_id. Used for JABCO construction tendering and DragonBridge deal tracking. DragonBridge sub-architecture session required before Phase 3.';


--
-- Name: COLUMN crm_sales_pipeline.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_sales_pipeline.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN crm_sales_pipeline.assigned_to; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.crm_sales_pipeline.assigned_to IS 'cross-db ref: jag_core.users.id';


--
-- Name: db_clients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    client_type public.db_client_type NOT NULL,
    name character varying(200) NOT NULL,
    company_name character varying(200),
    contact_name character varying(100),
    contact_email character varying(200),
    contact_phone character varying(50),
    address text,
    pricing_tier_id uuid,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_by uuid
);


--
-- Name: db_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    deposit_pct_default numeric(5,2) DEFAULT 30.00 NOT NULL,
    balance_trigger character varying(15) DEFAULT 'PRE_DELIVERY'::character varying NOT NULL,
    variance_threshold_pct numeric(5,2) DEFAULT 5.00 NOT NULL,
    default_vat_pct numeric(5,2) DEFAULT 12.50 NOT NULL,
    agency_fee_pct numeric(5,2) DEFAULT 5.00 NOT NULL,
    freight_apportionment_method character varying(10) DEFAULT 'CBM'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT db_config_agency_fee_pct_check CHECK ((agency_fee_pct >= (0)::numeric)),
    CONSTRAINT db_config_balance_trigger_check CHECK (((balance_trigger)::text = ANY ((ARRAY['PRE_DELIVERY'::character varying, 'ON_DELIVERY'::character varying])::text[]))),
    CONSTRAINT db_config_default_vat_pct_check CHECK ((default_vat_pct >= (0)::numeric)),
    CONSTRAINT db_config_deposit_pct_default_check CHECK (((deposit_pct_default > (0)::numeric) AND (deposit_pct_default < (100)::numeric))),
    CONSTRAINT db_config_freight_apportionment_method_check CHECK (((freight_apportionment_method)::text = ANY ((ARRAY['CBM'::character varying, 'VALUE'::character varying, 'EQUAL'::character varying])::text[]))),
    CONSTRAINT db_config_variance_threshold_pct_check CHECK ((variance_threshold_pct >= (0)::numeric))
);


--
-- Name: db_customs_declarations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_customs_declarations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    shipment_id uuid NOT NULL,
    declaration_ref character varying(100),
    actual_cif_usd numeric(14,2) NOT NULL,
    actual_duty_ttd numeric(14,2) NOT NULL,
    actual_vat_ttd numeric(14,2) NOT NULL,
    cleared_at timestamp with time zone,
    customs_broker character varying(200),
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT db_customs_declarations_actual_cif_usd_check CHECK ((actual_cif_usd >= (0)::numeric)),
    CONSTRAINT db_customs_declarations_actual_duty_ttd_check CHECK ((actual_duty_ttd >= (0)::numeric)),
    CONSTRAINT db_customs_declarations_actual_vat_ttd_check CHECK ((actual_vat_ttd >= (0)::numeric))
);


--
-- Name: db_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    invoice_type public.db_invoice_type NOT NULL,
    status public.db_invoice_status DEFAULT 'DRAFT'::public.db_invoice_status NOT NULL,
    amount_ttd numeric(16,2) NOT NULL,
    deposit_offset_ttd numeric(16,2) DEFAULT 0 NOT NULL,
    balance_due_ttd numeric(16,2) NOT NULL,
    issued_at timestamp with time zone,
    due_date date,
    paid_at timestamp with time zone,
    payment_method character varying(50),
    notes text,
    idempotency_key uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT db_invoices_amount_ttd_check CHECK ((amount_ttd >= (0)::numeric)),
    CONSTRAINT db_invoices_balance_due_ttd_check CHECK ((balance_due_ttd >= (0)::numeric)),
    CONSTRAINT db_invoices_deposit_offset_ttd_check CHECK ((deposit_offset_ttd >= (0)::numeric))
);


--
-- Name: db_landed_cost_reconciliations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_landed_cost_reconciliations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    status public.db_reconciliation_status DEFAULT 'PENDING'::public.db_reconciliation_status NOT NULL,
    quoted_total_ttd numeric(16,2) NOT NULL,
    actual_supplier_cost_ttd numeric(14,2) DEFAULT 0 CONSTRAINT db_landed_cost_reconciliation_actual_supplier_cost_ttd_not_null NOT NULL,
    actual_freight_ttd numeric(14,2) DEFAULT 0 NOT NULL,
    actual_insurance_ttd numeric(14,2) DEFAULT 0 NOT NULL,
    actual_duty_ttd numeric(14,2) DEFAULT 0 NOT NULL,
    actual_vat_ttd numeric(14,2) DEFAULT 0 NOT NULL,
    actual_local_delivery_ttd numeric(14,2) DEFAULT 0 CONSTRAINT db_landed_cost_reconciliatio_actual_local_delivery_ttd_not_null NOT NULL,
    actual_margin_ttd numeric(14,2) DEFAULT 0 NOT NULL,
    actual_agency_fee_ttd numeric(14,2) DEFAULT 0 NOT NULL,
    actual_total_ttd numeric(16,2) DEFAULT 0 NOT NULL,
    variance_ttd numeric(16,2) DEFAULT 0 NOT NULL,
    variance_pct numeric(8,4) DEFAULT 0 NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    notes text,
    idempotency_key uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: db_local_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_local_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    order_id uuid NOT NULL,
    delivery_address text NOT NULL,
    contact_name character varying(100),
    contact_phone character varying(50),
    cost_ttd numeric(12,2) DEFAULT 0 NOT NULL,
    status public.db_delivery_status DEFAULT 'SCHEDULED'::public.db_delivery_status NOT NULL,
    scheduled_date date,
    delivered_at timestamp with time zone,
    notes text,
    idempotency_key uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT db_local_deliveries_cost_ttd_check CHECK ((cost_ttd >= (0)::numeric))
);


--
-- Name: db_order_shipments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_order_shipments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    shipment_id uuid NOT NULL,
    freight_share_pct numeric(7,4),
    CONSTRAINT db_order_shipments_freight_share_pct_check CHECK (((freight_share_pct > (0)::numeric) AND (freight_share_pct <= (100)::numeric)))
);


--
-- Name: db_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    quote_id uuid NOT NULL,
    client_id uuid NOT NULL,
    jag_role public.db_jag_role NOT NULL,
    status public.db_order_status DEFAULT 'CONFIRMED'::public.db_order_status NOT NULL,
    deposit_pct numeric(5,2) NOT NULL,
    deposit_amount_ttd numeric(16,2) NOT NULL,
    deposit_paid_at timestamp with time zone,
    deposit_idempotency_key uuid,
    quoted_total_ttd numeric(16,2) NOT NULL,
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT db_orders_deposit_amount_ttd_check CHECK ((deposit_amount_ttd >= (0)::numeric)),
    CONSTRAINT db_orders_deposit_pct_check CHECK (((deposit_pct > (0)::numeric) AND (deposit_pct < (100)::numeric)))
);


--
-- Name: db_pricing_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_pricing_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(50) NOT NULL,
    default_margin_pct numeric(5,2) NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT db_pricing_tiers_default_margin_pct_check CHECK ((default_margin_pct >= (0)::numeric))
);


--
-- Name: db_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    supplier_id uuid NOT NULL,
    name character varying(200) NOT NULL,
    description text,
    hs_code character varying(10) NOT NULL,
    unit_cost_cny numeric(14,4) NOT NULL,
    unit character varying(20) DEFAULT 'EACH'::character varying NOT NULL,
    duty_rate numeric(6,4) DEFAULT 0 NOT NULL,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_by uuid,
    CONSTRAINT db_products_duty_rate_check CHECK (((duty_rate >= (0)::numeric) AND (duty_rate <= (1)::numeric))),
    CONSTRAINT db_products_unit_cost_cny_check CHECK ((unit_cost_cny > (0)::numeric))
);


--
-- Name: db_quote_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_quote_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quote_id uuid NOT NULL,
    product_id uuid,
    product_name character varying(200) NOT NULL,
    hs_code character varying(10) NOT NULL,
    unit_cost_cny numeric(14,4) NOT NULL,
    duty_rate numeric(6,4) NOT NULL,
    qty numeric(12,3) NOT NULL,
    unit character varying(20) NOT NULL,
    gross_volume_cbm numeric(10,4),
    est_duty_ttd numeric(14,2) DEFAULT 0 NOT NULL,
    est_vat_ttd numeric(14,2) DEFAULT 0 NOT NULL,
    est_landed_cost_ttd numeric(16,2) DEFAULT 0 NOT NULL,
    notes text,
    CONSTRAINT db_quote_items_duty_rate_check CHECK (((duty_rate >= (0)::numeric) AND (duty_rate <= (1)::numeric))),
    CONSTRAINT db_quote_items_gross_volume_cbm_check CHECK ((gross_volume_cbm > (0)::numeric)),
    CONSTRAINT db_quote_items_qty_check CHECK ((qty > (0)::numeric)),
    CONSTRAINT db_quote_items_unit_cost_cny_check CHECK ((unit_cost_cny > (0)::numeric))
);


--
-- Name: db_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    client_id uuid NOT NULL,
    jag_role public.db_jag_role NOT NULL,
    status public.db_quote_status DEFAULT 'DRAFT'::public.db_quote_status NOT NULL,
    margin_pct numeric(5,2),
    fx_cny_usd numeric(12,6) NOT NULL,
    fx_usd_ttd numeric(12,6) NOT NULL,
    est_freight_usd numeric(14,2) DEFAULT 0 NOT NULL,
    est_insurance_usd numeric(14,2) DEFAULT 0 NOT NULL,
    est_local_delivery_ttd numeric(14,2) DEFAULT 0 NOT NULL,
    agency_fee_pct numeric(5,2),
    est_agency_fee_ttd numeric(14,2) DEFAULT 0 NOT NULL,
    est_total_ttd numeric(16,2) DEFAULT 0 NOT NULL,
    notes text,
    valid_until date,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT db_quotes_agency_fee_pct_check CHECK ((agency_fee_pct >= (0)::numeric)),
    CONSTRAINT db_quotes_est_agency_fee_ttd_check CHECK ((est_agency_fee_ttd >= (0)::numeric)),
    CONSTRAINT db_quotes_est_freight_usd_check CHECK ((est_freight_usd >= (0)::numeric)),
    CONSTRAINT db_quotes_est_insurance_usd_check CHECK ((est_insurance_usd >= (0)::numeric)),
    CONSTRAINT db_quotes_est_local_delivery_ttd_check CHECK ((est_local_delivery_ttd >= (0)::numeric)),
    CONSTRAINT db_quotes_fx_cny_usd_check CHECK ((fx_cny_usd > (0)::numeric)),
    CONSTRAINT db_quotes_fx_usd_ttd_check CHECK ((fx_usd_ttd > (0)::numeric)),
    CONSTRAINT db_quotes_margin_pct_check CHECK ((margin_pct >= (0)::numeric))
);


--
-- Name: db_shipments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_shipments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    container_ref character varying(50),
    vessel_name character varying(200),
    port_of_origin character varying(100) DEFAULT 'SHANGHAI'::character varying NOT NULL,
    port_of_destination character varying(100) DEFAULT 'PORT OF SPAIN'::character varying NOT NULL,
    etd date,
    eta date,
    atd date,
    ata date,
    status public.db_shipment_status DEFAULT 'BOOKING'::public.db_shipment_status NOT NULL,
    actual_freight_usd numeric(14,2),
    actual_insurance_usd numeric(14,2),
    freight_forwarder character varying(200),
    notes text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT db_shipments_actual_freight_usd_check CHECK ((actual_freight_usd >= (0)::numeric)),
    CONSTRAINT db_shipments_actual_insurance_usd_check CHECK ((actual_insurance_usd >= (0)::numeric))
);


--
-- Name: db_suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.db_suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(200) NOT NULL,
    contact_name character varying(100),
    contact_email character varying(200),
    contact_phone character varying(50),
    address text,
    currency character(3) DEFAULT 'CNY'::bpchar NOT NULL,
    payment_terms text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_by uuid
);


--
-- Name: ims_barcodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ims_barcodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    barcode_value character varying NOT NULL,
    barcode_type character varying NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ims_barcodes FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE ims_barcodes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ims_barcodes IS 'RLS: tenant_id. barcode_value uniqueness is platform-wide to prevent scan collisions.';


--
-- Name: COLUMN ims_barcodes.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_barcodes.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN ims_barcodes.barcode_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_barcodes.barcode_type IS 'QR | CODE128 | EAN13 | EAN8 | DATAMATRIX';


--
-- Name: ims_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ims_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying NOT NULL,
    parent_category_id uuid,
    description text,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ims_categories FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE ims_categories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ims_categories IS 'RLS: tenant_id.';


--
-- Name: COLUMN ims_categories.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_categories.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN ims_categories.parent_category_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_categories.parent_category_id IS 'Self-ref for hierarchy e.g. Tools > Power Tools';


--
-- Name: ims_item_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ims_item_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ims_item_tags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ims_item_tags IS 'Junction: ims_items <-> ims_tags. Access governed by ims_items RLS.';


--
-- Name: ims_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ims_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    location_id uuid NOT NULL,
    category_id uuid,
    name character varying NOT NULL,
    description text,
    sku character varying,
    unit_of_measure character varying DEFAULT 'each'::character varying NOT NULL,
    quantity_on_hand numeric DEFAULT 0 NOT NULL,
    quantity_reserved numeric DEFAULT 0 NOT NULL,
    reorder_point numeric,
    unit_value numeric,
    serial_number character varying,
    condition public.item_condition DEFAULT 'GOOD'::public.item_condition NOT NULL,
    is_asset boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    vat_code public.ims_vat_code DEFAULT 'STANDARD'::public.ims_vat_code NOT NULL
);

ALTER TABLE ONLY public.ims_items FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE ims_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ims_items IS 'RLS: tenant_id. JABCO FLEET and personal FLEET vehicles are items with is_asset=true and category VEHICLE. ims_vehicles extends this table with vehicle-specific fields.';


--
-- Name: COLUMN ims_items.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_items.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN ims_items.sku; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_items.sku IS 'Unique per tenant — used for barcode generation';


--
-- Name: COLUMN ims_items.unit_of_measure; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_items.unit_of_measure IS 'each | kg | m | L | m2 | m3';


--
-- Name: COLUMN ims_items.unit_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_items.unit_value IS 'Asset valuation — not a sale price';


--
-- Name: COLUMN ims_items.is_asset; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_items.is_asset IS 'True for capital assets (vehicles, equipment). False for consumables.';


--
-- Name: COLUMN ims_items.last_modified_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_items.last_modified_by IS 'cross-db ref: jag_core.users.id';


--
-- Name: ims_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ims_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    code character varying NOT NULL,
    name character varying NOT NULL,
    address text,
    is_active boolean DEFAULT true NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ims_locations FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE ims_locations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ims_locations IS 'RLS: tenant_id. Seed locations: Barataria Home, Fyzabad Home, JABCO Office/Yard.';


--
-- Name: COLUMN ims_locations.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_locations.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN ims_locations.code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_locations.code IS 'e.g. BARATARIA_HOME, FYZABAD_HOME, JABCO_OFFICE, JABCO_YARD';


--
-- Name: COLUMN ims_locations.last_modified_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_locations.last_modified_by IS 'cross-db ref: jag_core.users.id';


--
-- Name: ims_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ims_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    storage_path character varying NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    uploaded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ims_photos FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE ims_photos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ims_photos IS 'RLS: tenant_id.';


--
-- Name: COLUMN ims_photos.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_photos.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN ims_photos.storage_path; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_photos.storage_path IS 'MinIO object path e.g. ims/items/{item_id}/{uuid}.jpg';


--
-- Name: COLUMN ims_photos.uploaded_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_photos.uploaded_by IS 'cross-db ref: jag_core.users.id';


--
-- Name: ims_stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ims_stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    from_location_id uuid,
    to_location_id uuid,
    quantity numeric NOT NULL,
    movement_type public.movement_type NOT NULL,
    reference_type character varying,
    reference_id uuid,
    notes text,
    performed_by uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sale_price numeric(12,2),
    vat_amount numeric(12,2),
    customer_name character varying(200),
    internal_entity uuid
);

ALTER TABLE ONLY public.ims_stock_movements FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE ims_stock_movements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ims_stock_movements IS 'RLS: tenant_id. OFFLINE-CRITICAL — idempotency_key prevents duplicate posting on reconnect (STD-11).';


--
-- Name: COLUMN ims_stock_movements.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_stock_movements.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN ims_stock_movements.reference_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_stock_movements.reference_type IS 'e.g. JABCO_PROJECT, PURCHASE_ORDER';


--
-- Name: COLUMN ims_stock_movements.reference_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_stock_movements.reference_id IS 'ID of the reference document';


--
-- Name: COLUMN ims_stock_movements.performed_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_stock_movements.performed_by IS 'cross-db ref: jag_core.users.id';


--
-- Name: ims_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ims_tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying NOT NULL,
    color character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ims_tags FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE ims_tags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ims_tags IS 'RLS: tenant_id.';


--
-- Name: COLUMN ims_tags.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_tags.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN ims_tags.color; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_tags.color IS 'Hex color for UI display e.g. #FF5733';


--
-- Name: ims_vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ims_vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    item_id uuid NOT NULL,
    fleet_type character varying NOT NULL,
    registration_number character varying NOT NULL,
    make character varying NOT NULL,
    model character varying NOT NULL,
    year integer NOT NULL,
    colour character varying,
    vehicle_type public.vehicle_type NOT NULL,
    fuel_type character varying NOT NULL,
    vin character varying,
    engine_number character varying,
    insurance_policy_number character varying,
    insurance_provider character varying,
    insurance_expiry date,
    registration_expiry date,
    purchase_date date,
    purchase_price numeric,
    current_mileage_km integer,
    assigned_to_user_id uuid,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.ims_vehicles FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE ims_vehicles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ims_vehicles IS 'RLS: tenant_id. Personal fleet records also have a counterpart in jag_family.fam_personal_vehicles for family-admin data. Cross-DB reference held as ims_item_id in jag_family.';


--
-- Name: COLUMN ims_vehicles.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_vehicles.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN ims_vehicles.item_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_vehicles.item_id IS 'One-to-one extension of ims_items';


--
-- Name: COLUMN ims_vehicles.fleet_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_vehicles.fleet_type IS 'JABCO_FLEET | PERSONAL_FLEET';


--
-- Name: COLUMN ims_vehicles.fuel_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_vehicles.fuel_type IS 'PETROL | DIESEL | HYBRID | ELECTRIC | NONE';


--
-- Name: COLUMN ims_vehicles.assigned_to_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_vehicles.assigned_to_user_id IS 'cross-db ref: jag_core.users.id — primary driver/user';


--
-- Name: COLUMN ims_vehicles.last_modified_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ims_vehicles.last_modified_by IS 'cross-db ref: jag_core.users.id';


--
-- Name: jabco_boq_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jabco_boq_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    section character varying NOT NULL,
    item_number character varying,
    description text NOT NULL,
    unit character varying NOT NULL,
    quantity_budgeted numeric NOT NULL,
    unit_rate numeric NOT NULL,
    amount_budgeted numeric NOT NULL,
    quantity_actual numeric DEFAULT 0 NOT NULL,
    amount_actual numeric DEFAULT 0 NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.jabco_boq_items FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE jabco_boq_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.jabco_boq_items IS 'RLS: tenant_id.';


--
-- Name: COLUMN jabco_boq_items.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_boq_items.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN jabco_boq_items.section; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_boq_items.section IS 'e.g. Earthworks, Concrete Works, Drainage';


--
-- Name: COLUMN jabco_boq_items.item_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_boq_items.item_number IS 'BOQ line item reference number';


--
-- Name: COLUMN jabco_boq_items.unit; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_boq_items.unit IS 'e.g. m3, m2, lm, sum, item';


--
-- Name: COLUMN jabco_boq_items.amount_budgeted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_boq_items.amount_budgeted IS 'quantity_budgeted x unit_rate — denormalised for reporting';


--
-- Name: jabco_payment_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jabco_payment_certificates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    progress_claim_id uuid NOT NULL,
    certificate_number character varying NOT NULL,
    amount_certified numeric NOT NULL,
    issued_date date NOT NULL,
    due_date date,
    paid_date date,
    idempotency_key uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    vat_pct numeric(5,2) DEFAULT 12.5 NOT NULL,
    vat_amount numeric(14,2) DEFAULT 0 NOT NULL,
    gross_certified numeric(14,2) DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY public.jabco_payment_certificates FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE jabco_payment_certificates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.jabco_payment_certificates IS 'RLS: tenant_id.';


--
-- Name: COLUMN jabco_payment_certificates.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_payment_certificates.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: jabco_progress_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jabco_progress_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    claim_number integer NOT NULL,
    period_from date NOT NULL,
    period_to date NOT NULL,
    amount_claimed numeric NOT NULL,
    amount_certified numeric,
    status public.claim_status DEFAULT 'DRAFT'::public.claim_status NOT NULL,
    submitted_date date,
    certified_date date,
    paid_date date,
    idempotency_key uuid NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.jabco_progress_claims FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE jabco_progress_claims; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.jabco_progress_claims IS 'RLS: tenant_id. Financial write — idempotency_key required (STD-11).';


--
-- Name: COLUMN jabco_progress_claims.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_progress_claims.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: jabco_project_gantt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jabco_project_gantt (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_name character varying NOT NULL,
    planned_start date NOT NULL,
    planned_end date NOT NULL,
    actual_start date,
    actual_end date,
    predecessor_id uuid,
    completion_percentage numeric DEFAULT 0 NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.jabco_project_gantt FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE jabco_project_gantt; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.jabco_project_gantt IS 'RLS: tenant_id.';


--
-- Name: COLUMN jabco_project_gantt.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_project_gantt.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN jabco_project_gantt.predecessor_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_project_gantt.predecessor_id IS 'Self-ref for task dependencies';


--
-- Name: jabco_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jabco_projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_code character varying NOT NULL,
    name character varying NOT NULL,
    client_name character varying NOT NULL,
    client_type character varying NOT NULL,
    status public.project_status DEFAULT 'TENDER'::public.project_status NOT NULL,
    contract_value numeric NOT NULL,
    contract_currency character varying(3) DEFAULT 'TTD'::character varying NOT NULL,
    start_date date,
    expected_end_date date,
    actual_end_date date,
    site_address text,
    project_manager_id uuid NOT NULL,
    idempotency_key uuid NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    vat_inclusive boolean DEFAULT false NOT NULL,
    vat_pct numeric(5,2) DEFAULT 12.5 NOT NULL,
    CONSTRAINT jabco_projects_vat_pct_check CHECK (((vat_pct >= (0)::numeric) AND (vat_pct <= (100)::numeric)))
);

ALTER TABLE ONLY public.jabco_projects FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE jabco_projects; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.jabco_projects IS 'RLS: tenant_id. Offline sync supported — foremen access project data offline. Financial amounts in TTD by default; multi-currency for government contracts.';


--
-- Name: COLUMN jabco_projects.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_projects.tenant_id IS 'cross-db ref: jag_core.tenants.id — always JABCO tenant';


--
-- Name: COLUMN jabco_projects.client_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_projects.client_type IS 'GOVERNMENT | PRIVATE';


--
-- Name: COLUMN jabco_projects.project_manager_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_projects.project_manager_id IS 'cross-db ref: jag_core.users.id';


--
-- Name: COLUMN jabco_projects.last_modified_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_projects.last_modified_by IS 'cross-db ref: jag_core.users.id';


--
-- Name: COLUMN jabco_projects.vat_inclusive; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_projects.vat_inclusive IS 'true = contract price includes VAT; false = VAT added on top (exclusive)';


--
-- Name: jabco_site_diary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jabco_site_diary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    foreman_id uuid NOT NULL,
    entry_date date NOT NULL,
    weather character varying,
    workers_on_site integer,
    activities_completed text,
    materials_received text,
    equipment_on_site text,
    instructions_received text,
    issues_noted text,
    photos jsonb,
    sync_status public.sync_status DEFAULT 'SYNCED'::public.sync_status NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.jabco_site_diary FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE jabco_site_diary; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.jabco_site_diary IS 'RLS: tenant_id. OFFLINE-CRITICAL: sync_status tracks pending-sync records. Conflicts route to Conflict Review queue — non-conflicting updates auto-merge. Mobile PWA foreman app writes here.';


--
-- Name: COLUMN jabco_site_diary.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_site_diary.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN jabco_site_diary.foreman_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_site_diary.foreman_id IS 'cross-db ref: jag_core.users.id';


--
-- Name: COLUMN jabco_site_diary.photos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_site_diary.photos IS 'Array of MinIO storage paths';


--
-- Name: COLUMN jabco_site_diary.last_modified_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_site_diary.last_modified_by IS 'cross-db ref: jag_core.users.id';


--
-- Name: jabco_subcontractor_retention; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jabco_subcontractor_retention (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    subcontractor_name character varying NOT NULL,
    subcontractor_contact character varying,
    contract_amount numeric NOT NULL,
    retention_percentage numeric DEFAULT 5 NOT NULL,
    retention_amount_held numeric NOT NULL,
    retention_released numeric DEFAULT 0 NOT NULL,
    release_condition character varying NOT NULL,
    defects_liability_expiry date,
    status public.retention_status DEFAULT 'HOLDING'::public.retention_status NOT NULL,
    idempotency_key uuid NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.jabco_subcontractor_retention FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE jabco_subcontractor_retention; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.jabco_subcontractor_retention IS 'RLS: tenant_id. Financial write — idempotency_key required (STD-11).';


--
-- Name: COLUMN jabco_subcontractor_retention.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_subcontractor_retention.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN jabco_subcontractor_retention.release_condition; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_subcontractor_retention.release_condition IS 'PRACTICAL_COMPLETION | DEFECTS_LIABILITY_EXPIRY';


--
-- Name: jabco_variation_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jabco_variation_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    vo_number character varying NOT NULL,
    description text NOT NULL,
    status public.vo_status DEFAULT 'PENDING'::public.vo_status NOT NULL,
    amount numeric NOT NULL,
    currency character varying(3) DEFAULT 'TTD'::character varying NOT NULL,
    submitted_date date,
    approved_date date,
    approved_by uuid,
    idempotency_key uuid NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.jabco_variation_orders FORCE ROW LEVEL SECURITY;


--
-- Name: TABLE jabco_variation_orders; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.jabco_variation_orders IS 'RLS: tenant_id.';


--
-- Name: COLUMN jabco_variation_orders.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_variation_orders.tenant_id IS 'cross-db ref: jag_core.tenants.id';


--
-- Name: COLUMN jabco_variation_orders.approved_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.jabco_variation_orders.approved_by IS 'cross-db ref: jag_core.users.id';


--
-- Name: jabco_vendor_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jabco_vendor_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    project_id uuid NOT NULL,
    vendor_name character varying(200) NOT NULL,
    vendor_type character varying(50) DEFAULT 'SUPPLIER'::character varying NOT NULL,
    invoice_ref character varying(100),
    invoice_date date NOT NULL,
    due_date date,
    amount numeric(12,2) NOT NULL,
    vat_code public.jabco_vat_code DEFAULT 'STANDARD'::public.jabco_vat_code NOT NULL,
    vat_amount numeric(12,2) DEFAULT 0 NOT NULL,
    status public.jabco_invoice_status DEFAULT 'RECEIVED'::public.jabco_invoice_status NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    paid_date date,
    payment_reference character varying(200),
    notes text,
    idempotency_key uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jabco_vendor_invoices_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT jabco_vendor_invoices_vat_amount_check CHECK ((vat_amount >= (0)::numeric))
);


--
-- Name: nlcb_bill_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nlcb_bill_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    session_id uuid NOT NULL,
    biller_id uuid NOT NULL,
    amount_collected numeric(12,2) NOT NULL,
    flat_fee numeric(8,2) DEFAULT 0.00 NOT NULL,
    customer_ref character varying(100),
    idempotency_key uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT nlcb_bill_payments_amount_collected_check CHECK ((amount_collected > (0)::numeric)),
    CONSTRAINT nlcb_bill_payments_flat_fee_check CHECK ((flat_fee >= (0)::numeric))
);


--
-- Name: nlcb_billers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nlcb_billers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    flat_fee numeric(8,2) DEFAULT 0.00 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_by uuid,
    CONSTRAINT nlcb_billers_flat_fee_check CHECK ((flat_fee >= (0)::numeric))
);


--
-- Name: nlcb_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nlcb_config (
    tenant_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: nlcb_daily_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nlcb_daily_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    session_date date NOT NULL,
    opened_by uuid NOT NULL,
    cash_float_open numeric(12,2) NOT NULL,
    cash_float_close numeric(12,2),
    status public.nlcb_session_status DEFAULT 'OPEN'::public.nlcb_session_status NOT NULL,
    notes text,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_by uuid,
    CONSTRAINT nlcb_daily_sessions_cash_float_close_check CHECK ((cash_float_close >= (0)::numeric)),
    CONSTRAINT nlcb_daily_sessions_cash_float_open_check CHECK ((cash_float_open >= (0)::numeric))
);


--
-- Name: nlcb_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nlcb_expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    expense_date date NOT NULL,
    category character varying(50) NOT NULL,
    description text NOT NULL,
    amount numeric(12,2) NOT NULL,
    vat_amount numeric(12,2) DEFAULT 0 NOT NULL,
    vendor_name character varying(200),
    status public.nlcb_expense_status DEFAULT 'PENDING'::public.nlcb_expense_status NOT NULL,
    paid_at timestamp with time zone,
    notes text,
    idempotency_key uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT nlcb_expenses_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT nlcb_expenses_category_check CHECK (((category)::text = ANY ((ARRAY['RENT'::character varying, 'UTILITY'::character varying, 'SUPPLIES'::character varying, 'STAFF'::character varying, 'OTHER'::character varying])::text[]))),
    CONSTRAINT nlcb_expenses_vat_amount_check CHECK ((vat_amount >= (0)::numeric))
);


--
-- Name: nlcb_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nlcb_games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    draw_frequency character varying(20) NOT NULL,
    commission_rate numeric(5,2) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_by uuid,
    max_agent_payout numeric(12,2) DEFAULT 5600.00 NOT NULL,
    cashing_commission_rate numeric(5,2) DEFAULT 1.00 NOT NULL,
    CONSTRAINT nlcb_games_commission_rate_check CHECK (((commission_rate >= (0)::numeric) AND (commission_rate <= (100)::numeric)))
);


--
-- Name: nlcb_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nlcb_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    session_id uuid NOT NULL,
    game_id uuid NOT NULL,
    payout_amount numeric(12,2) NOT NULL,
    ticket_ref character varying(100),
    notes text,
    idempotency_key uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_large_win boolean DEFAULT false NOT NULL,
    cashing_commission_rate numeric(5,2) DEFAULT 1.00 NOT NULL,
    cashing_commission_amount numeric(12,2) DEFAULT 0 NOT NULL,
    CONSTRAINT nlcb_payouts_payout_amount_check CHECK ((payout_amount > (0)::numeric))
);


--
-- Name: nlcb_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nlcb_sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    session_id uuid NOT NULL,
    game_id uuid NOT NULL,
    gross_sales numeric(12,2) NOT NULL,
    commission_rate numeric(5,2) NOT NULL,
    commission_amount numeric(12,2) NOT NULL,
    idempotency_key uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT nlcb_sales_commission_amount_check CHECK ((commission_amount >= (0)::numeric)),
    CONSTRAINT nlcb_sales_commission_rate_check CHECK ((commission_rate >= (0)::numeric)),
    CONSTRAINT nlcb_sales_gross_sales_check CHECK ((gross_sales >= (0)::numeric))
);


--
-- Name: nlcb_scratch_games; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nlcb_scratch_games (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    denomination numeric(8,2) NOT NULL,
    commission_rate numeric(5,2) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_at timestamp with time zone DEFAULT now() NOT NULL,
    last_modified_by uuid,
    max_agent_payout numeric(12,2) DEFAULT 12000.00 NOT NULL,
    cashing_commission_rate numeric(5,2) DEFAULT 1.00 NOT NULL,
    CONSTRAINT nlcb_scratch_games_commission_rate_check CHECK (((commission_rate >= (0)::numeric) AND (commission_rate <= (100)::numeric))),
    CONSTRAINT nlcb_scratch_games_denomination_check CHECK ((denomination > (0)::numeric))
);


--
-- Name: nlcb_scratch_pack_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nlcb_scratch_pack_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    game_id uuid NOT NULL,
    purchase_date date NOT NULL,
    packs_purchased integer NOT NULL,
    tickets_per_pack integer DEFAULT 50 NOT NULL,
    total_tickets integer GENERATED ALWAYS AS ((packs_purchased * tickets_per_pack)) STORED,
    face_value_per_ticket numeric(8,2) NOT NULL,
    total_face_value numeric(12,2) NOT NULL,
    commission_rate numeric(5,2) NOT NULL,
    commission_amount numeric(12,2) NOT NULL,
    purchase_price numeric(12,2) NOT NULL,
    delivery_ref character varying(100),
    received_by uuid NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT nlcb_scratch_pack_purchases_face_value_per_ticket_check CHECK ((face_value_per_ticket > (0)::numeric)),
    CONSTRAINT nlcb_scratch_pack_purchases_packs_purchased_check CHECK ((packs_purchased > 0)),
    CONSTRAINT nlcb_scratch_pack_purchases_tickets_per_pack_check CHECK ((tickets_per_pack > 0))
);


--
-- Name: nlcb_scratch_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nlcb_scratch_sales (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    session_id uuid NOT NULL,
    game_id uuid NOT NULL,
    pack_purchase_id uuid,
    tickets_sold integer NOT NULL,
    gross_value numeric(12,2) NOT NULL,
    idempotency_key uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT nlcb_scratch_sales_gross_value_check CHECK ((gross_value > (0)::numeric)),
    CONSTRAINT nlcb_scratch_sales_tickets_sold_check CHECK ((tickets_sold > 0))
);


--
-- Name: nlcb_scratch_winnings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nlcb_scratch_winnings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    session_id uuid NOT NULL,
    game_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    ticket_ref character varying(100),
    is_large_win boolean DEFAULT false NOT NULL,
    notes text,
    idempotency_key uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cashing_commission_rate numeric(5,2) DEFAULT 1.00 NOT NULL,
    cashing_commission_amount numeric(12,2) DEFAULT 0 NOT NULL,
    CONSTRAINT nlcb_scratch_winnings_amount_check CHECK ((amount > (0)::numeric))
);


--
-- Name: nlcb_weekly_settlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nlcb_weekly_settlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    week_start date NOT NULL,
    week_end date NOT NULL,
    total_sales numeric(12,2) DEFAULT 0 NOT NULL,
    total_payouts numeric(12,2) DEFAULT 0 NOT NULL,
    total_commission numeric(12,2) DEFAULT 0 NOT NULL,
    net_owed numeric(12,2) DEFAULT 0 NOT NULL,
    status public.nlcb_settlement_status DEFAULT 'PENDING'::public.nlcb_settlement_status NOT NULL,
    paid_at timestamp with time zone,
    paid_amount numeric(12,2),
    reference_number character varying(100),
    notes text,
    idempotency_key uuid NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    total_scratch_winnings_paid numeric(12,2) DEFAULT 0 NOT NULL,
    total_bill_collections numeric(12,2) DEFAULT 0 NOT NULL,
    total_bill_fees numeric(12,2) DEFAULT 0 NOT NULL,
    total_draw_cashing_commission numeric(12,2) DEFAULT 0 NOT NULL,
    total_scratch_cashing_commission numeric(12,2) DEFAULT 0 CONSTRAINT nlcb_weekly_settlements_total_scratch_cashing_commissi_not_null NOT NULL
);


--
-- Name: pending_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    aggregate_type character varying NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type character varying NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    retry_count integer DEFAULT 0 NOT NULL,
    last_error text,
    failed_at timestamp with time zone
);


--
-- Name: TABLE pending_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.pending_events IS 'Append-only outbox. jag-event-dispatcher polls every 5s.';


--
-- Name: COLUMN pending_events.aggregate_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pending_events.aggregate_type IS 'e.g. ImsItem, JabcoProject, CrmContact';


--
-- Name: COLUMN pending_events.event_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.pending_events.event_type IS 'e.g. ims.stock_low, jabco.claim_certified, crm.lead_won';


--
-- Name: pgmigrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pgmigrations (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    run_on timestamp without time zone NOT NULL
);


--
-- Name: pgmigrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pgmigrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pgmigrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pgmigrations_id_seq OWNED BY public.pgmigrations.id;


--
-- Name: pgmigrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgmigrations ALTER COLUMN id SET DEFAULT nextval('public.pgmigrations_id_seq'::regclass);


--
-- Name: crm_companies crm_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_companies
    ADD CONSTRAINT crm_companies_pkey PRIMARY KEY (id);


--
-- Name: crm_contacts crm_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_pkey PRIMARY KEY (id);


--
-- Name: crm_interactions crm_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_interactions
    ADD CONSTRAINT crm_interactions_pkey PRIMARY KEY (id);


--
-- Name: crm_sales_pipeline crm_sales_pipeline_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sales_pipeline
    ADD CONSTRAINT crm_sales_pipeline_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: crm_sales_pipeline crm_sales_pipeline_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sales_pipeline
    ADD CONSTRAINT crm_sales_pipeline_pkey PRIMARY KEY (id);


--
-- Name: db_clients db_clients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_clients
    ADD CONSTRAINT db_clients_pkey PRIMARY KEY (id);


--
-- Name: db_config db_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_config
    ADD CONSTRAINT db_config_pkey PRIMARY KEY (id);


--
-- Name: db_config db_config_tenant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_config
    ADD CONSTRAINT db_config_tenant_id_key UNIQUE (tenant_id);


--
-- Name: db_customs_declarations db_customs_declarations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_customs_declarations
    ADD CONSTRAINT db_customs_declarations_pkey PRIMARY KEY (id);


--
-- Name: db_customs_declarations db_customs_declarations_shipment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_customs_declarations
    ADD CONSTRAINT db_customs_declarations_shipment_id_key UNIQUE (shipment_id);


--
-- Name: db_invoices db_invoices_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_invoices
    ADD CONSTRAINT db_invoices_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: db_invoices db_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_invoices
    ADD CONSTRAINT db_invoices_pkey PRIMARY KEY (id);


--
-- Name: db_landed_cost_reconciliations db_landed_cost_reconciliations_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_landed_cost_reconciliations
    ADD CONSTRAINT db_landed_cost_reconciliations_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: db_landed_cost_reconciliations db_landed_cost_reconciliations_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_landed_cost_reconciliations
    ADD CONSTRAINT db_landed_cost_reconciliations_order_id_key UNIQUE (order_id);


--
-- Name: db_landed_cost_reconciliations db_landed_cost_reconciliations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_landed_cost_reconciliations
    ADD CONSTRAINT db_landed_cost_reconciliations_pkey PRIMARY KEY (id);


--
-- Name: db_local_deliveries db_local_deliveries_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_local_deliveries
    ADD CONSTRAINT db_local_deliveries_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: db_local_deliveries db_local_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_local_deliveries
    ADD CONSTRAINT db_local_deliveries_pkey PRIMARY KEY (id);


--
-- Name: db_order_shipments db_order_shipments_order_id_shipment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_order_shipments
    ADD CONSTRAINT db_order_shipments_order_id_shipment_id_key UNIQUE (order_id, shipment_id);


--
-- Name: db_order_shipments db_order_shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_order_shipments
    ADD CONSTRAINT db_order_shipments_pkey PRIMARY KEY (id);


--
-- Name: db_orders db_orders_deposit_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_orders
    ADD CONSTRAINT db_orders_deposit_idempotency_key_key UNIQUE (deposit_idempotency_key);


--
-- Name: db_orders db_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_orders
    ADD CONSTRAINT db_orders_pkey PRIMARY KEY (id);


--
-- Name: db_orders db_orders_quote_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_orders
    ADD CONSTRAINT db_orders_quote_id_key UNIQUE (quote_id);


--
-- Name: db_pricing_tiers db_pricing_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_pricing_tiers
    ADD CONSTRAINT db_pricing_tiers_pkey PRIMARY KEY (id);


--
-- Name: db_pricing_tiers db_pricing_tiers_tenant_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_pricing_tiers
    ADD CONSTRAINT db_pricing_tiers_tenant_id_name_key UNIQUE (tenant_id, name);


--
-- Name: db_products db_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_products
    ADD CONSTRAINT db_products_pkey PRIMARY KEY (id);


--
-- Name: db_quote_items db_quote_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_quote_items
    ADD CONSTRAINT db_quote_items_pkey PRIMARY KEY (id);


--
-- Name: db_quotes db_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_quotes
    ADD CONSTRAINT db_quotes_pkey PRIMARY KEY (id);


--
-- Name: db_shipments db_shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_shipments
    ADD CONSTRAINT db_shipments_pkey PRIMARY KEY (id);


--
-- Name: db_suppliers db_suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_suppliers
    ADD CONSTRAINT db_suppliers_pkey PRIMARY KEY (id);


--
-- Name: ims_barcodes ims_barcodes_barcode_value_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_barcodes
    ADD CONSTRAINT ims_barcodes_barcode_value_key UNIQUE (barcode_value);


--
-- Name: ims_barcodes ims_barcodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_barcodes
    ADD CONSTRAINT ims_barcodes_pkey PRIMARY KEY (id);


--
-- Name: ims_categories ims_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_categories
    ADD CONSTRAINT ims_categories_pkey PRIMARY KEY (id);


--
-- Name: ims_item_tags ims_item_tags_item_tag_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_item_tags
    ADD CONSTRAINT ims_item_tags_item_tag_unique UNIQUE (item_id, tag_id);


--
-- Name: ims_item_tags ims_item_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_item_tags
    ADD CONSTRAINT ims_item_tags_pkey PRIMARY KEY (id);


--
-- Name: ims_items ims_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_items
    ADD CONSTRAINT ims_items_pkey PRIMARY KEY (id);


--
-- Name: ims_locations ims_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_locations
    ADD CONSTRAINT ims_locations_pkey PRIMARY KEY (id);


--
-- Name: ims_photos ims_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_photos
    ADD CONSTRAINT ims_photos_pkey PRIMARY KEY (id);


--
-- Name: ims_stock_movements ims_stock_movements_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_stock_movements
    ADD CONSTRAINT ims_stock_movements_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: ims_stock_movements ims_stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_stock_movements
    ADD CONSTRAINT ims_stock_movements_pkey PRIMARY KEY (id);


--
-- Name: ims_tags ims_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_tags
    ADD CONSTRAINT ims_tags_pkey PRIMARY KEY (id);


--
-- Name: ims_vehicles ims_vehicles_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_vehicles
    ADD CONSTRAINT ims_vehicles_item_id_key UNIQUE (item_id);


--
-- Name: ims_vehicles ims_vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_vehicles
    ADD CONSTRAINT ims_vehicles_pkey PRIMARY KEY (id);


--
-- Name: jabco_boq_items jabco_boq_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_boq_items
    ADD CONSTRAINT jabco_boq_items_pkey PRIMARY KEY (id);


--
-- Name: jabco_payment_certificates jabco_payment_certificates_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_payment_certificates
    ADD CONSTRAINT jabco_payment_certificates_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: jabco_payment_certificates jabco_payment_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_payment_certificates
    ADD CONSTRAINT jabco_payment_certificates_pkey PRIMARY KEY (id);


--
-- Name: jabco_progress_claims jabco_progress_claims_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_progress_claims
    ADD CONSTRAINT jabco_progress_claims_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: jabco_progress_claims jabco_progress_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_progress_claims
    ADD CONSTRAINT jabco_progress_claims_pkey PRIMARY KEY (id);


--
-- Name: jabco_project_gantt jabco_project_gantt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_project_gantt
    ADD CONSTRAINT jabco_project_gantt_pkey PRIMARY KEY (id);


--
-- Name: jabco_projects jabco_projects_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_projects
    ADD CONSTRAINT jabco_projects_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: jabco_projects jabco_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_projects
    ADD CONSTRAINT jabco_projects_pkey PRIMARY KEY (id);


--
-- Name: jabco_projects jabco_projects_project_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_projects
    ADD CONSTRAINT jabco_projects_project_code_key UNIQUE (project_code);


--
-- Name: jabco_site_diary jabco_site_diary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_site_diary
    ADD CONSTRAINT jabco_site_diary_pkey PRIMARY KEY (id);


--
-- Name: jabco_subcontractor_retention jabco_subcontractor_retention_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_subcontractor_retention
    ADD CONSTRAINT jabco_subcontractor_retention_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: jabco_subcontractor_retention jabco_subcontractor_retention_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_subcontractor_retention
    ADD CONSTRAINT jabco_subcontractor_retention_pkey PRIMARY KEY (id);


--
-- Name: jabco_variation_orders jabco_variation_orders_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_variation_orders
    ADD CONSTRAINT jabco_variation_orders_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: jabco_variation_orders jabco_variation_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_variation_orders
    ADD CONSTRAINT jabco_variation_orders_pkey PRIMARY KEY (id);


--
-- Name: jabco_vendor_invoices jabco_vendor_invoices_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_vendor_invoices
    ADD CONSTRAINT jabco_vendor_invoices_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: jabco_vendor_invoices jabco_vendor_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_vendor_invoices
    ADD CONSTRAINT jabco_vendor_invoices_pkey PRIMARY KEY (id);


--
-- Name: nlcb_bill_payments nlcb_bill_payments_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_bill_payments
    ADD CONSTRAINT nlcb_bill_payments_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: nlcb_bill_payments nlcb_bill_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_bill_payments
    ADD CONSTRAINT nlcb_bill_payments_pkey PRIMARY KEY (id);


--
-- Name: nlcb_billers nlcb_billers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_billers
    ADD CONSTRAINT nlcb_billers_pkey PRIMARY KEY (id);


--
-- Name: nlcb_config nlcb_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_config
    ADD CONSTRAINT nlcb_config_pkey PRIMARY KEY (tenant_id);


--
-- Name: nlcb_daily_sessions nlcb_daily_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_daily_sessions
    ADD CONSTRAINT nlcb_daily_sessions_pkey PRIMARY KEY (id);


--
-- Name: nlcb_expenses nlcb_expenses_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_expenses
    ADD CONSTRAINT nlcb_expenses_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: nlcb_expenses nlcb_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_expenses
    ADD CONSTRAINT nlcb_expenses_pkey PRIMARY KEY (id);


--
-- Name: nlcb_games nlcb_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_games
    ADD CONSTRAINT nlcb_games_pkey PRIMARY KEY (id);


--
-- Name: nlcb_daily_sessions nlcb_one_session_per_day; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_daily_sessions
    ADD CONSTRAINT nlcb_one_session_per_day UNIQUE (tenant_id, session_date);


--
-- Name: nlcb_weekly_settlements nlcb_one_settlement_per_week; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_weekly_settlements
    ADD CONSTRAINT nlcb_one_settlement_per_week UNIQUE (tenant_id, week_start);


--
-- Name: nlcb_payouts nlcb_payouts_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_payouts
    ADD CONSTRAINT nlcb_payouts_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: nlcb_payouts nlcb_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_payouts
    ADD CONSTRAINT nlcb_payouts_pkey PRIMARY KEY (id);


--
-- Name: nlcb_sales nlcb_sales_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_sales
    ADD CONSTRAINT nlcb_sales_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: nlcb_sales nlcb_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_sales
    ADD CONSTRAINT nlcb_sales_pkey PRIMARY KEY (id);


--
-- Name: nlcb_scratch_games nlcb_scratch_games_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_scratch_games
    ADD CONSTRAINT nlcb_scratch_games_pkey PRIMARY KEY (id);


--
-- Name: nlcb_scratch_pack_purchases nlcb_scratch_pack_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_scratch_pack_purchases
    ADD CONSTRAINT nlcb_scratch_pack_purchases_pkey PRIMARY KEY (id);


--
-- Name: nlcb_scratch_sales nlcb_scratch_sales_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_scratch_sales
    ADD CONSTRAINT nlcb_scratch_sales_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: nlcb_scratch_sales nlcb_scratch_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_scratch_sales
    ADD CONSTRAINT nlcb_scratch_sales_pkey PRIMARY KEY (id);


--
-- Name: nlcb_scratch_winnings nlcb_scratch_winnings_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_scratch_winnings
    ADD CONSTRAINT nlcb_scratch_winnings_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: nlcb_scratch_winnings nlcb_scratch_winnings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_scratch_winnings
    ADD CONSTRAINT nlcb_scratch_winnings_pkey PRIMARY KEY (id);


--
-- Name: nlcb_weekly_settlements nlcb_weekly_settlements_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_weekly_settlements
    ADD CONSTRAINT nlcb_weekly_settlements_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: nlcb_weekly_settlements nlcb_weekly_settlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_weekly_settlements
    ADD CONSTRAINT nlcb_weekly_settlements_pkey PRIMARY KEY (id);


--
-- Name: pending_events pending_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_events
    ADD CONSTRAINT pending_events_pkey PRIMARY KEY (id);


--
-- Name: pgmigrations pgmigrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pgmigrations
    ADD CONSTRAINT pgmigrations_pkey PRIMARY KEY (id);


--
-- Name: idx_boq_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_boq_project ON public.jabco_boq_items USING btree (project_id);


--
-- Name: idx_boq_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_boq_tenant ON public.jabco_boq_items USING btree (tenant_id);


--
-- Name: idx_claims_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_claims_idempotency ON public.jabco_progress_claims USING btree (idempotency_key);


--
-- Name: idx_claims_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_claims_project ON public.jabco_progress_claims USING btree (project_id);


--
-- Name: idx_claims_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_claims_status ON public.jabco_progress_claims USING btree (status);


--
-- Name: idx_claims_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_claims_tenant ON public.jabco_progress_claims USING btree (tenant_id);


--
-- Name: idx_crm_companies_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_companies_tenant ON public.crm_companies USING btree (tenant_id);


--
-- Name: idx_crm_contacts_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_contacts_company ON public.crm_contacts USING btree (company_id);


--
-- Name: idx_crm_contacts_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_contacts_email ON public.crm_contacts USING btree (email);


--
-- Name: idx_crm_contacts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_contacts_tenant ON public.crm_contacts USING btree (tenant_id);


--
-- Name: idx_crm_inter_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_inter_contact ON public.crm_interactions USING btree (contact_id);


--
-- Name: idx_crm_inter_follow_up; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_inter_follow_up ON public.crm_interactions USING btree (follow_up_date);


--
-- Name: idx_crm_inter_occurred_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_inter_occurred_at ON public.crm_interactions USING btree (occurred_at);


--
-- Name: idx_crm_inter_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crm_inter_tenant ON public.crm_interactions USING btree (tenant_id);


--
-- Name: idx_db_clients_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_clients_tenant ON public.db_clients USING btree (tenant_id);


--
-- Name: idx_db_clients_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_clients_type ON public.db_clients USING btree (client_type);


--
-- Name: idx_db_customs_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_customs_shipment ON public.db_customs_declarations USING btree (shipment_id);


--
-- Name: idx_db_customs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_customs_tenant ON public.db_customs_declarations USING btree (tenant_id);


--
-- Name: idx_db_deliveries_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_deliveries_idem ON public.db_local_deliveries USING btree (idempotency_key);


--
-- Name: idx_db_deliveries_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_deliveries_order ON public.db_local_deliveries USING btree (order_id);


--
-- Name: idx_db_deliveries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_deliveries_status ON public.db_local_deliveries USING btree (status);


--
-- Name: idx_db_deliveries_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_deliveries_tenant ON public.db_local_deliveries USING btree (tenant_id);


--
-- Name: idx_db_invoices_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_invoices_idem ON public.db_invoices USING btree (idempotency_key);


--
-- Name: idx_db_invoices_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_invoices_order ON public.db_invoices USING btree (order_id);


--
-- Name: idx_db_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_invoices_status ON public.db_invoices USING btree (status);


--
-- Name: idx_db_invoices_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_invoices_tenant ON public.db_invoices USING btree (tenant_id);


--
-- Name: idx_db_invoices_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_invoices_type ON public.db_invoices USING btree (invoice_type);


--
-- Name: idx_db_order_shipments_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_order_shipments_order ON public.db_order_shipments USING btree (order_id);


--
-- Name: idx_db_order_shipments_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_order_shipments_shipment ON public.db_order_shipments USING btree (shipment_id);


--
-- Name: idx_db_orders_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_orders_client ON public.db_orders USING btree (client_id);


--
-- Name: idx_db_orders_dep_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_orders_dep_idem ON public.db_orders USING btree (deposit_idempotency_key);


--
-- Name: idx_db_orders_quote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_orders_quote ON public.db_orders USING btree (quote_id);


--
-- Name: idx_db_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_orders_status ON public.db_orders USING btree (status);


--
-- Name: idx_db_orders_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_orders_tenant ON public.db_orders USING btree (tenant_id);


--
-- Name: idx_db_pricing_tiers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_pricing_tiers_tenant ON public.db_pricing_tiers USING btree (tenant_id);


--
-- Name: idx_db_products_hs; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_products_hs ON public.db_products USING btree (hs_code);


--
-- Name: idx_db_products_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_products_supplier ON public.db_products USING btree (supplier_id);


--
-- Name: idx_db_products_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_products_tenant ON public.db_products USING btree (tenant_id);


--
-- Name: idx_db_quote_items_quote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_quote_items_quote ON public.db_quote_items USING btree (quote_id);


--
-- Name: idx_db_quotes_client; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_quotes_client ON public.db_quotes USING btree (client_id);


--
-- Name: idx_db_quotes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_quotes_status ON public.db_quotes USING btree (status);


--
-- Name: idx_db_quotes_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_quotes_tenant ON public.db_quotes USING btree (tenant_id);


--
-- Name: idx_db_recon_idem; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_recon_idem ON public.db_landed_cost_reconciliations USING btree (idempotency_key);


--
-- Name: idx_db_recon_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_recon_order ON public.db_landed_cost_reconciliations USING btree (order_id);


--
-- Name: idx_db_recon_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_recon_status ON public.db_landed_cost_reconciliations USING btree (status);


--
-- Name: idx_db_recon_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_recon_tenant ON public.db_landed_cost_reconciliations USING btree (tenant_id);


--
-- Name: idx_db_shipments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_shipments_status ON public.db_shipments USING btree (status);


--
-- Name: idx_db_shipments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_shipments_tenant ON public.db_shipments USING btree (tenant_id);


--
-- Name: idx_db_suppliers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_db_suppliers_tenant ON public.db_suppliers USING btree (tenant_id);


--
-- Name: idx_diary_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diary_date ON public.jabco_site_diary USING btree (entry_date);


--
-- Name: idx_diary_foreman; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diary_foreman ON public.jabco_site_diary USING btree (foreman_id);


--
-- Name: idx_diary_last_modified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diary_last_modified ON public.jabco_site_diary USING btree (last_modified_at);


--
-- Name: idx_diary_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diary_project ON public.jabco_site_diary USING btree (project_id);


--
-- Name: idx_diary_sync_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diary_sync_status ON public.jabco_site_diary USING btree (sync_status);


--
-- Name: idx_diary_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diary_tenant ON public.jabco_site_diary USING btree (tenant_id);


--
-- Name: idx_gantt_predecessor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gantt_predecessor ON public.jabco_project_gantt USING btree (predecessor_id);


--
-- Name: idx_gantt_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gantt_project ON public.jabco_project_gantt USING btree (project_id);


--
-- Name: idx_gantt_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gantt_tenant ON public.jabco_project_gantt USING btree (tenant_id);


--
-- Name: idx_ims_barcodes_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_barcodes_item ON public.ims_barcodes USING btree (item_id);


--
-- Name: idx_ims_barcodes_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_barcodes_tenant ON public.ims_barcodes USING btree (tenant_id);


--
-- Name: idx_ims_barcodes_value; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ims_barcodes_value ON public.ims_barcodes USING btree (barcode_value);


--
-- Name: idx_ims_cat_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_cat_parent ON public.ims_categories USING btree (parent_category_id);


--
-- Name: idx_ims_cat_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_cat_tenant ON public.ims_categories USING btree (tenant_id);


--
-- Name: idx_ims_item_tags_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ims_item_tags_pair ON public.ims_item_tags USING btree (item_id, tag_id);


--
-- Name: idx_ims_items_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_items_category ON public.ims_items USING btree (category_id);


--
-- Name: idx_ims_items_last_modified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_items_last_modified ON public.ims_items USING btree (last_modified_at);


--
-- Name: idx_ims_items_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_items_location ON public.ims_items USING btree (location_id);


--
-- Name: idx_ims_items_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_items_sku ON public.ims_items USING btree (sku);


--
-- Name: idx_ims_items_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_items_tenant ON public.ims_items USING btree (tenant_id);


--
-- Name: idx_ims_locations_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_locations_code ON public.ims_locations USING btree (code);


--
-- Name: idx_ims_locations_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_locations_tenant ON public.ims_locations USING btree (tenant_id);


--
-- Name: idx_ims_movements_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ims_movements_idempotency ON public.ims_stock_movements USING btree (idempotency_key);


--
-- Name: idx_ims_movements_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_movements_item ON public.ims_stock_movements USING btree (item_id);


--
-- Name: idx_ims_movements_last_modified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_movements_last_modified ON public.ims_stock_movements USING btree (last_modified_at);


--
-- Name: idx_ims_movements_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_movements_ref ON public.ims_stock_movements USING btree (reference_type, reference_id);


--
-- Name: idx_ims_movements_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_movements_tenant ON public.ims_stock_movements USING btree (tenant_id);


--
-- Name: idx_ims_photos_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_photos_item ON public.ims_photos USING btree (item_id);


--
-- Name: idx_ims_photos_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_photos_tenant ON public.ims_photos USING btree (tenant_id);


--
-- Name: idx_ims_tags_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_tags_tenant ON public.ims_tags USING btree (tenant_id);


--
-- Name: idx_ims_veh_fleet_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_veh_fleet_type ON public.ims_vehicles USING btree (fleet_type);


--
-- Name: idx_ims_veh_ins_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_veh_ins_expiry ON public.ims_vehicles USING btree (insurance_expiry);


--
-- Name: idx_ims_veh_rego; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_veh_rego ON public.ims_vehicles USING btree (registration_number);


--
-- Name: idx_ims_veh_rego_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_veh_rego_expiry ON public.ims_vehicles USING btree (registration_expiry);


--
-- Name: idx_ims_veh_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ims_veh_tenant ON public.ims_vehicles USING btree (tenant_id);


--
-- Name: idx_jabco_proj_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_jabco_proj_code ON public.jabco_projects USING btree (project_code);


--
-- Name: idx_jabco_proj_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_jabco_proj_idempotency ON public.jabco_projects USING btree (idempotency_key);


--
-- Name: idx_jabco_proj_last_modified; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jabco_proj_last_modified ON public.jabco_projects USING btree (last_modified_at);


--
-- Name: idx_jabco_proj_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jabco_proj_status ON public.jabco_projects USING btree (status);


--
-- Name: idx_jabco_proj_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jabco_proj_tenant ON public.jabco_projects USING btree (tenant_id);


--
-- Name: idx_jabco_vendor_invoices_idempotent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jabco_vendor_invoices_idempotent ON public.jabco_vendor_invoices USING btree (idempotency_key);


--
-- Name: idx_jabco_vendor_invoices_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jabco_vendor_invoices_project ON public.jabco_vendor_invoices USING btree (project_id);


--
-- Name: idx_jabco_vendor_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jabco_vendor_invoices_status ON public.jabco_vendor_invoices USING btree (status);


--
-- Name: idx_jabco_vendor_invoices_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_jabco_vendor_invoices_tenant ON public.jabco_vendor_invoices USING btree (tenant_id);


--
-- Name: idx_nlcb_bill_payments_idempotent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_bill_payments_idempotent ON public.nlcb_bill_payments USING btree (idempotency_key);


--
-- Name: idx_nlcb_bill_payments_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_bill_payments_session ON public.nlcb_bill_payments USING btree (session_id);


--
-- Name: idx_nlcb_bill_payments_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_bill_payments_tenant ON public.nlcb_bill_payments USING btree (tenant_id);


--
-- Name: idx_nlcb_billers_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_billers_tenant ON public.nlcb_billers USING btree (tenant_id);


--
-- Name: idx_nlcb_expenses_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_expenses_date ON public.nlcb_expenses USING btree (expense_date);


--
-- Name: idx_nlcb_expenses_idempotent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_expenses_idempotent ON public.nlcb_expenses USING btree (idempotency_key);


--
-- Name: idx_nlcb_expenses_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_expenses_tenant ON public.nlcb_expenses USING btree (tenant_id);


--
-- Name: idx_nlcb_games_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_games_tenant ON public.nlcb_games USING btree (tenant_id);


--
-- Name: idx_nlcb_payouts_idempotent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_payouts_idempotent ON public.nlcb_payouts USING btree (idempotency_key);


--
-- Name: idx_nlcb_payouts_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_payouts_session ON public.nlcb_payouts USING btree (session_id);


--
-- Name: idx_nlcb_payouts_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_payouts_tenant ON public.nlcb_payouts USING btree (tenant_id);


--
-- Name: idx_nlcb_sales_idempotent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_sales_idempotent ON public.nlcb_sales USING btree (idempotency_key);


--
-- Name: idx_nlcb_sales_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_sales_session ON public.nlcb_sales USING btree (session_id);


--
-- Name: idx_nlcb_sales_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_sales_tenant ON public.nlcb_sales USING btree (tenant_id);


--
-- Name: idx_nlcb_scratch_games_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_scratch_games_tenant ON public.nlcb_scratch_games USING btree (tenant_id);


--
-- Name: idx_nlcb_scratch_purchases_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_scratch_purchases_date ON public.nlcb_scratch_pack_purchases USING btree (purchase_date);


--
-- Name: idx_nlcb_scratch_purchases_game; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_scratch_purchases_game ON public.nlcb_scratch_pack_purchases USING btree (game_id);


--
-- Name: idx_nlcb_scratch_purchases_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_scratch_purchases_tenant ON public.nlcb_scratch_pack_purchases USING btree (tenant_id);


--
-- Name: idx_nlcb_scratch_sales_idempotent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_scratch_sales_idempotent ON public.nlcb_scratch_sales USING btree (idempotency_key);


--
-- Name: idx_nlcb_scratch_sales_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_scratch_sales_session ON public.nlcb_scratch_sales USING btree (session_id);


--
-- Name: idx_nlcb_scratch_sales_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_scratch_sales_tenant ON public.nlcb_scratch_sales USING btree (tenant_id);


--
-- Name: idx_nlcb_scratch_winnings_idempotent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_scratch_winnings_idempotent ON public.nlcb_scratch_winnings USING btree (idempotency_key);


--
-- Name: idx_nlcb_scratch_winnings_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_scratch_winnings_session ON public.nlcb_scratch_winnings USING btree (session_id);


--
-- Name: idx_nlcb_scratch_winnings_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_scratch_winnings_tenant ON public.nlcb_scratch_winnings USING btree (tenant_id);


--
-- Name: idx_nlcb_sessions_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_sessions_date ON public.nlcb_daily_sessions USING btree (session_date);


--
-- Name: idx_nlcb_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_sessions_status ON public.nlcb_daily_sessions USING btree (status);


--
-- Name: idx_nlcb_sessions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_sessions_tenant ON public.nlcb_daily_sessions USING btree (tenant_id);


--
-- Name: idx_nlcb_settlements_idempotent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_settlements_idempotent ON public.nlcb_weekly_settlements USING btree (idempotency_key);


--
-- Name: idx_nlcb_settlements_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_settlements_status ON public.nlcb_weekly_settlements USING btree (status);


--
-- Name: idx_nlcb_settlements_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_settlements_tenant ON public.nlcb_weekly_settlements USING btree (tenant_id);


--
-- Name: idx_nlcb_settlements_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nlcb_settlements_week ON public.nlcb_weekly_settlements USING btree (week_start);


--
-- Name: idx_pc_claim; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pc_claim ON public.jabco_payment_certificates USING btree (progress_claim_id);


--
-- Name: idx_pc_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pc_idempotency ON public.jabco_payment_certificates USING btree (idempotency_key);


--
-- Name: idx_pc_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pc_tenant ON public.jabco_payment_certificates USING btree (tenant_id);


--
-- Name: idx_pe_comm_aggregate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pe_comm_aggregate ON public.pending_events USING btree (aggregate_type, aggregate_id);


--
-- Name: idx_pe_comm_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pe_comm_created_at ON public.pending_events USING btree (created_at);


--
-- Name: idx_pe_comm_failed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pe_comm_failed_at ON public.pending_events USING btree (failed_at);


--
-- Name: idx_pe_comm_processed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pe_comm_processed_at ON public.pending_events USING btree (processed_at);


--
-- Name: idx_pipeline_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_assigned ON public.crm_sales_pipeline USING btree (assigned_to);


--
-- Name: idx_pipeline_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pipeline_idempotency ON public.crm_sales_pipeline USING btree (idempotency_key);


--
-- Name: idx_pipeline_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_stage ON public.crm_sales_pipeline USING btree (stage);


--
-- Name: idx_pipeline_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_tenant ON public.crm_sales_pipeline USING btree (tenant_id);


--
-- Name: idx_retention_dl_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retention_dl_expiry ON public.jabco_subcontractor_retention USING btree (defects_liability_expiry);


--
-- Name: idx_retention_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_retention_idempotency ON public.jabco_subcontractor_retention USING btree (idempotency_key);


--
-- Name: idx_retention_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retention_project ON public.jabco_subcontractor_retention USING btree (project_id);


--
-- Name: idx_retention_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retention_tenant ON public.jabco_subcontractor_retention USING btree (tenant_id);


--
-- Name: idx_vo_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_vo_idempotency ON public.jabco_variation_orders USING btree (idempotency_key);


--
-- Name: idx_vo_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vo_project ON public.jabco_variation_orders USING btree (project_id);


--
-- Name: idx_vo_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vo_status ON public.jabco_variation_orders USING btree (status);


--
-- Name: idx_vo_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vo_tenant ON public.jabco_variation_orders USING btree (tenant_id);


--
-- Name: crm_contacts crm_contacts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_contacts
    ADD CONSTRAINT crm_contacts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.crm_companies(id);


--
-- Name: crm_interactions crm_interactions_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_interactions
    ADD CONSTRAINT crm_interactions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id);


--
-- Name: crm_sales_pipeline crm_sales_pipeline_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sales_pipeline
    ADD CONSTRAINT crm_sales_pipeline_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.crm_companies(id);


--
-- Name: crm_sales_pipeline crm_sales_pipeline_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crm_sales_pipeline
    ADD CONSTRAINT crm_sales_pipeline_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id);


--
-- Name: db_clients db_clients_pricing_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_clients
    ADD CONSTRAINT db_clients_pricing_tier_id_fkey FOREIGN KEY (pricing_tier_id) REFERENCES public.db_pricing_tiers(id);


--
-- Name: db_customs_declarations db_customs_declarations_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_customs_declarations
    ADD CONSTRAINT db_customs_declarations_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.db_shipments(id);


--
-- Name: db_invoices db_invoices_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_invoices
    ADD CONSTRAINT db_invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.db_orders(id);


--
-- Name: db_landed_cost_reconciliations db_landed_cost_reconciliations_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_landed_cost_reconciliations
    ADD CONSTRAINT db_landed_cost_reconciliations_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.db_orders(id);


--
-- Name: db_local_deliveries db_local_deliveries_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_local_deliveries
    ADD CONSTRAINT db_local_deliveries_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.db_orders(id);


--
-- Name: db_order_shipments db_order_shipments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_order_shipments
    ADD CONSTRAINT db_order_shipments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.db_orders(id);


--
-- Name: db_order_shipments db_order_shipments_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_order_shipments
    ADD CONSTRAINT db_order_shipments_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.db_shipments(id);


--
-- Name: db_orders db_orders_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_orders
    ADD CONSTRAINT db_orders_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.db_clients(id);


--
-- Name: db_orders db_orders_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_orders
    ADD CONSTRAINT db_orders_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.db_quotes(id);


--
-- Name: db_products db_products_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_products
    ADD CONSTRAINT db_products_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.db_suppliers(id);


--
-- Name: db_quote_items db_quote_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_quote_items
    ADD CONSTRAINT db_quote_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.db_products(id);


--
-- Name: db_quote_items db_quote_items_quote_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_quote_items
    ADD CONSTRAINT db_quote_items_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.db_quotes(id) ON DELETE CASCADE;


--
-- Name: db_quotes db_quotes_client_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.db_quotes
    ADD CONSTRAINT db_quotes_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.db_clients(id);


--
-- Name: ims_barcodes ims_barcodes_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_barcodes
    ADD CONSTRAINT ims_barcodes_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.ims_items(id);


--
-- Name: ims_categories ims_categories_parent_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_categories
    ADD CONSTRAINT ims_categories_parent_category_id_fkey FOREIGN KEY (parent_category_id) REFERENCES public.ims_categories(id);


--
-- Name: ims_item_tags ims_item_tags_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_item_tags
    ADD CONSTRAINT ims_item_tags_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.ims_items(id);


--
-- Name: ims_item_tags ims_item_tags_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_item_tags
    ADD CONSTRAINT ims_item_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.ims_tags(id);


--
-- Name: ims_items ims_items_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_items
    ADD CONSTRAINT ims_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.ims_categories(id);


--
-- Name: ims_items ims_items_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_items
    ADD CONSTRAINT ims_items_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.ims_locations(id);


--
-- Name: ims_photos ims_photos_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_photos
    ADD CONSTRAINT ims_photos_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.ims_items(id);


--
-- Name: ims_stock_movements ims_stock_movements_from_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_stock_movements
    ADD CONSTRAINT ims_stock_movements_from_location_id_fkey FOREIGN KEY (from_location_id) REFERENCES public.ims_locations(id);


--
-- Name: ims_stock_movements ims_stock_movements_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_stock_movements
    ADD CONSTRAINT ims_stock_movements_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.ims_items(id);


--
-- Name: ims_stock_movements ims_stock_movements_to_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_stock_movements
    ADD CONSTRAINT ims_stock_movements_to_location_id_fkey FOREIGN KEY (to_location_id) REFERENCES public.ims_locations(id);


--
-- Name: ims_vehicles ims_vehicles_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ims_vehicles
    ADD CONSTRAINT ims_vehicles_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.ims_items(id);


--
-- Name: jabco_boq_items jabco_boq_items_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_boq_items
    ADD CONSTRAINT jabco_boq_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.jabco_projects(id);


--
-- Name: jabco_payment_certificates jabco_payment_certificates_progress_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_payment_certificates
    ADD CONSTRAINT jabco_payment_certificates_progress_claim_id_fkey FOREIGN KEY (progress_claim_id) REFERENCES public.jabco_progress_claims(id);


--
-- Name: jabco_progress_claims jabco_progress_claims_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_progress_claims
    ADD CONSTRAINT jabco_progress_claims_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.jabco_projects(id);


--
-- Name: jabco_project_gantt jabco_project_gantt_predecessor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_project_gantt
    ADD CONSTRAINT jabco_project_gantt_predecessor_id_fkey FOREIGN KEY (predecessor_id) REFERENCES public.jabco_project_gantt(id);


--
-- Name: jabco_project_gantt jabco_project_gantt_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_project_gantt
    ADD CONSTRAINT jabco_project_gantt_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.jabco_projects(id);


--
-- Name: jabco_site_diary jabco_site_diary_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_site_diary
    ADD CONSTRAINT jabco_site_diary_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.jabco_projects(id);


--
-- Name: jabco_subcontractor_retention jabco_subcontractor_retention_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_subcontractor_retention
    ADD CONSTRAINT jabco_subcontractor_retention_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.jabco_projects(id);


--
-- Name: jabco_variation_orders jabco_variation_orders_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_variation_orders
    ADD CONSTRAINT jabco_variation_orders_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.jabco_projects(id);


--
-- Name: jabco_vendor_invoices jabco_vendor_invoices_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jabco_vendor_invoices
    ADD CONSTRAINT jabco_vendor_invoices_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.jabco_projects(id);


--
-- Name: nlcb_bill_payments nlcb_bill_payments_biller_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_bill_payments
    ADD CONSTRAINT nlcb_bill_payments_biller_id_fkey FOREIGN KEY (biller_id) REFERENCES public.nlcb_billers(id);


--
-- Name: nlcb_bill_payments nlcb_bill_payments_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_bill_payments
    ADD CONSTRAINT nlcb_bill_payments_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.nlcb_daily_sessions(id);


--
-- Name: nlcb_payouts nlcb_payouts_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_payouts
    ADD CONSTRAINT nlcb_payouts_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.nlcb_games(id);


--
-- Name: nlcb_payouts nlcb_payouts_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_payouts
    ADD CONSTRAINT nlcb_payouts_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.nlcb_daily_sessions(id);


--
-- Name: nlcb_sales nlcb_sales_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_sales
    ADD CONSTRAINT nlcb_sales_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.nlcb_games(id);


--
-- Name: nlcb_sales nlcb_sales_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_sales
    ADD CONSTRAINT nlcb_sales_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.nlcb_daily_sessions(id);


--
-- Name: nlcb_scratch_pack_purchases nlcb_scratch_pack_purchases_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_scratch_pack_purchases
    ADD CONSTRAINT nlcb_scratch_pack_purchases_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.nlcb_scratch_games(id);


--
-- Name: nlcb_scratch_sales nlcb_scratch_sales_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_scratch_sales
    ADD CONSTRAINT nlcb_scratch_sales_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.nlcb_scratch_games(id);


--
-- Name: nlcb_scratch_sales nlcb_scratch_sales_pack_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_scratch_sales
    ADD CONSTRAINT nlcb_scratch_sales_pack_purchase_id_fkey FOREIGN KEY (pack_purchase_id) REFERENCES public.nlcb_scratch_pack_purchases(id);


--
-- Name: nlcb_scratch_sales nlcb_scratch_sales_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_scratch_sales
    ADD CONSTRAINT nlcb_scratch_sales_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.nlcb_daily_sessions(id);


--
-- Name: nlcb_scratch_winnings nlcb_scratch_winnings_game_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_scratch_winnings
    ADD CONSTRAINT nlcb_scratch_winnings_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.nlcb_scratch_games(id);


--
-- Name: nlcb_scratch_winnings nlcb_scratch_winnings_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nlcb_scratch_winnings
    ADD CONSTRAINT nlcb_scratch_winnings_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.nlcb_daily_sessions(id);


--
-- Name: crm_companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_companies ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_interactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_interactions ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_sales_pipeline; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.crm_sales_pipeline ENABLE ROW LEVEL SECURITY;

--
-- Name: db_clients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_clients ENABLE ROW LEVEL SECURITY;

--
-- Name: db_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_config ENABLE ROW LEVEL SECURITY;

--
-- Name: db_customs_declarations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_customs_declarations ENABLE ROW LEVEL SECURITY;

--
-- Name: db_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: db_landed_cost_reconciliations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_landed_cost_reconciliations ENABLE ROW LEVEL SECURITY;

--
-- Name: db_local_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_local_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: db_order_shipments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_order_shipments ENABLE ROW LEVEL SECURITY;

--
-- Name: db_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: db_pricing_tiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_pricing_tiers ENABLE ROW LEVEL SECURITY;

--
-- Name: db_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_products ENABLE ROW LEVEL SECURITY;

--
-- Name: db_quote_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_quote_items ENABLE ROW LEVEL SECURITY;

--
-- Name: db_quotes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_quotes ENABLE ROW LEVEL SECURITY;

--
-- Name: db_shipments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_shipments ENABLE ROW LEVEL SECURITY;

--
-- Name: db_suppliers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.db_suppliers ENABLE ROW LEVEL SECURITY;

--
-- Name: ims_barcodes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ims_barcodes ENABLE ROW LEVEL SECURITY;

--
-- Name: ims_categories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ims_categories ENABLE ROW LEVEL SECURITY;

--
-- Name: ims_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ims_items ENABLE ROW LEVEL SECURITY;

--
-- Name: ims_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ims_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: ims_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ims_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: ims_stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ims_stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: ims_tags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ims_tags ENABLE ROW LEVEL SECURITY;

--
-- Name: ims_vehicles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ims_vehicles ENABLE ROW LEVEL SECURITY;

--
-- Name: jabco_boq_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jabco_boq_items ENABLE ROW LEVEL SECURITY;

--
-- Name: jabco_payment_certificates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jabco_payment_certificates ENABLE ROW LEVEL SECURITY;

--
-- Name: jabco_progress_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jabco_progress_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: jabco_project_gantt; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jabco_project_gantt ENABLE ROW LEVEL SECURITY;

--
-- Name: jabco_projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jabco_projects ENABLE ROW LEVEL SECURITY;

--
-- Name: jabco_site_diary; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jabco_site_diary ENABLE ROW LEVEL SECURITY;

--
-- Name: jabco_subcontractor_retention; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jabco_subcontractor_retention ENABLE ROW LEVEL SECURITY;

--
-- Name: jabco_variation_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jabco_variation_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: jabco_vendor_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jabco_vendor_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: nlcb_bill_payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nlcb_bill_payments ENABLE ROW LEVEL SECURITY;

--
-- Name: nlcb_billers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nlcb_billers ENABLE ROW LEVEL SECURITY;

--
-- Name: nlcb_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nlcb_config ENABLE ROW LEVEL SECURITY;

--
-- Name: nlcb_daily_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nlcb_daily_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: nlcb_expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nlcb_expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: nlcb_games; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nlcb_games ENABLE ROW LEVEL SECURITY;

--
-- Name: nlcb_payouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nlcb_payouts ENABLE ROW LEVEL SECURITY;

--
-- Name: nlcb_sales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nlcb_sales ENABLE ROW LEVEL SECURITY;

--
-- Name: nlcb_scratch_games; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nlcb_scratch_games ENABLE ROW LEVEL SECURITY;

--
-- Name: nlcb_scratch_pack_purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nlcb_scratch_pack_purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: nlcb_scratch_sales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nlcb_scratch_sales ENABLE ROW LEVEL SECURITY;

--
-- Name: nlcb_scratch_winnings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nlcb_scratch_winnings ENABLE ROW LEVEL SECURITY;

--
-- Name: nlcb_weekly_settlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nlcb_weekly_settlements ENABLE ROW LEVEL SECURITY;

--
-- Name: crm_companies tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_companies USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: crm_contacts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_contacts USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: crm_interactions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_interactions USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: crm_sales_pipeline tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.crm_sales_pipeline USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: db_clients tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_clients USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: db_config tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: db_customs_declarations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_customs_declarations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: db_invoices tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_invoices USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: db_landed_cost_reconciliations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_landed_cost_reconciliations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: db_local_deliveries tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_local_deliveries USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: db_order_shipments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_order_shipments USING ((order_id IN ( SELECT db_orders.id
   FROM public.db_orders
  WHERE (db_orders.tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))));


--
-- Name: db_orders tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_orders USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: db_pricing_tiers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_pricing_tiers USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: db_products tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_products USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: db_quote_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_quote_items USING ((quote_id IN ( SELECT db_quotes.id
   FROM public.db_quotes
  WHERE (db_quotes.tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))));


--
-- Name: db_quotes tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_quotes USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: db_shipments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_shipments USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: db_suppliers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.db_suppliers USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: ims_barcodes tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ims_barcodes USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: ims_categories tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ims_categories USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: ims_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ims_items USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: ims_locations tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ims_locations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: ims_photos tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ims_photos USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: ims_stock_movements tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ims_stock_movements USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: ims_tags tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ims_tags USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: ims_vehicles tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.ims_vehicles USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: jabco_boq_items tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.jabco_boq_items USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: jabco_payment_certificates tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.jabco_payment_certificates USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: jabco_progress_claims tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.jabco_progress_claims USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: jabco_project_gantt tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.jabco_project_gantt USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: jabco_projects tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.jabco_projects USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: jabco_site_diary tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.jabco_site_diary USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: jabco_subcontractor_retention tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.jabco_subcontractor_retention USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: jabco_variation_orders tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.jabco_variation_orders USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: jabco_vendor_invoices tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.jabco_vendor_invoices USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: nlcb_bill_payments tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nlcb_bill_payments USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: nlcb_billers tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nlcb_billers USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: nlcb_config tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nlcb_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: nlcb_daily_sessions tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nlcb_daily_sessions USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: nlcb_expenses tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nlcb_expenses USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: nlcb_games tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nlcb_games USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: nlcb_payouts tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nlcb_payouts USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: nlcb_sales tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nlcb_sales USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: nlcb_scratch_games tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nlcb_scratch_games USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: nlcb_scratch_pack_purchases tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nlcb_scratch_pack_purchases USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: nlcb_scratch_sales tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nlcb_scratch_sales USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: nlcb_scratch_winnings tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nlcb_scratch_winnings USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- Name: nlcb_weekly_settlements tenant_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tenant_isolation ON public.nlcb_weekly_settlements USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));


--
-- PostgreSQL database dump complete
--

\unrestrict BRFhzEyJiKHuj5mW9U1Cst59DVNBt5hMU3YPmcsetoU38HIHgwHd4ICmloVyIbq

