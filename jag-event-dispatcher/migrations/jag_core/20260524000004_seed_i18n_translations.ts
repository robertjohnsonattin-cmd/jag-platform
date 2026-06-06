import type { MigrationBuilder } from 'node-pg-migrate';

// Phase 1A — initial i18n seed: en + zh translations.
//
// Covers the strings that will appear in Tier 1 push notifications, module
// navigation, compliance status labels, and alert bodies surfaced by the
// event-dispatcher. These are the minimum required for a working Phase 1A UI.
//
// is_machine_translated rules (STD enforced in comment on i18n_translations):
//   false → financial, legal, compliance, alert, and succession strings (both locales)
//   true  → generic UI labels in zh only (pending wife's review before production)
//   All en strings are false — they are manually authored.
//
// Key pattern: module.semantic_id  e.g.  finance.bir_threshold_alert
// ON CONFLICT (key, locale) DO NOTHING — fully idempotent; safe to re-run.

export async function up(pgm: MigrationBuilder): Promise<void> {

  // ── Module navigation labels ─────────────────────────────────────────────────

  pgm.sql(`
    INSERT INTO i18n_translations (key, locale, value, module, is_machine_translated)
    VALUES
      ('common.module.dashboard',    'en', 'Dashboard',       NULL,         false),
      ('common.module.dashboard',    'zh', '仪表板',           NULL,         true),
      ('common.module.ims',          'en', 'Inventory',       'IMS',        false),
      ('common.module.ims',          'zh', '库存管理',          'IMS',        true),
      ('common.module.jabco',        'en', 'JABCO Projects',  'JABCO',      false),
      ('common.module.jabco',        'zh', 'JABCO项目',        'JABCO',      true),
      ('common.module.bar',          'en', 'Bar Operations',  'BAR',        false),
      ('common.module.bar',          'zh', '酒吧运营',          'BAR',        true),
      ('common.module.members_club', 'en', 'Members Club',    'BAR',        false),
      ('common.module.members_club', 'zh', '会员俱乐部',        'BAR',        true),
      ('common.module.properties',   'en', 'Properties',      'PROPERTIES', false),
      ('common.module.properties',   'zh', '房产',             'PROPERTIES', true),
      ('common.module.family',       'en', 'Family',          'FINANCE',    false),
      ('common.module.family',       'zh', '家庭',             'FINANCE',    true),
      ('common.module.crm',          'en', 'CRM',             'JABCO',      false),
      ('common.module.crm',          'zh', '客户管理',          'JABCO',      true)
    ON CONFLICT (key, locale) DO NOTHING;
  `);


  // ── Common status labels ─────────────────────────────────────────────────────

  pgm.sql(`
    INSERT INTO i18n_translations (key, locale, value, module, is_machine_translated)
    VALUES
      ('common.status.active',      'en', 'Active',      NULL, false),
      ('common.status.active',      'zh', '有效',         NULL, true),
      ('common.status.inactive',    'en', 'Inactive',    NULL, false),
      ('common.status.inactive',    'zh', '无效',         NULL, true),
      ('common.status.pending',     'en', 'Pending',     NULL, false),
      ('common.status.pending',     'zh', '待处理',        NULL, true),
      ('common.status.in_progress', 'en', 'In Progress', NULL, false),
      ('common.status.in_progress', 'zh', '进行中',        NULL, true),
      ('common.status.completed',   'en', 'Completed',   NULL, false),
      ('common.status.completed',   'zh', '已完成',        NULL, true),
      ('common.status.cancelled',   'en', 'Cancelled',   NULL, false),
      ('common.status.cancelled',   'zh', '已取消',        NULL, true),
      ('common.status.draft',       'en', 'Draft',       NULL, false),
      ('common.status.draft',       'zh', '草稿',         NULL, true),
      ('common.status.expired',     'en', 'Expired',     NULL, false),
      ('common.status.expired',     'zh', '已过期',        NULL, true),
      ('common.status.revoked',     'en', 'Revoked',     NULL, false),
      ('common.status.revoked',     'zh', '已撤销',        NULL, true)
    ON CONFLICT (key, locale) DO NOTHING;
  `);


  // ── Finance alerts — is_machine_translated = false (financial strings) ────────
  // BIR = Board of Inland Revenue, Trinidad & Tobago.
  // Personal allowance: TTD 90,000. 25% band: up to TTD 1,000,000. 30%: above.

  pgm.sql(`
    INSERT INTO i18n_translations (key, locale, value, module, is_machine_translated)
    VALUES
      ('finance.bir_threshold_alert', 'en',
       'BIR Alert: Estimated chargeable income is approaching the 30% tax band (TTD 1,000,000). Review with your accountant before year-end.',
       'FINANCE', false),
      ('finance.bir_threshold_alert', 'zh',
       '税务局提醒：估计应税收入正接近30%税率段（TTD 1,000,000）。请在财政年度结束前与您的会计师核实。',
       'FINANCE', false),

      ('finance.bir_personal_allowance_reminder', 'en',
       'BIR Reminder: Annual personal allowance is TTD 90,000. Ensure all qualifying deductions are captured.',
       'FINANCE', false),
      ('finance.bir_personal_allowance_reminder', 'zh',
       '税务局提醒：年度个人免税额为TTD 90,000。请确保所有符合资格的扣除项均已记录。',
       'FINANCE', false),

      ('finance.wipay_payment_received', 'en',
       'Payment received via WiPay: {amount} {currency} for {reference}.',
       'FINANCE', false),
      ('finance.wipay_payment_received', 'zh',
       '已通过WiPay收到付款：{reference}，金额{amount} {currency}。',
       'FINANCE', false),

      ('finance.wipay_payment_failed', 'en',
       'WiPay payment failed for {reference}. Amount: {amount} {currency}. Contact tenant or retry.',
       'FINANCE', false),
      ('finance.wipay_payment_failed', 'zh',
       'WiPay付款失败，参考号：{reference}，金额：{amount} {currency}。请联系租客或重试。',
       'FINANCE', false),

      ('finance.wipay_payment_refunded', 'en',
       'WiPay refund issued: {amount} {currency} for {reference}.',
       'FINANCE', false),
      ('finance.wipay_payment_refunded', 'zh',
       '已通过WiPay发起退款：{reference}，金额{amount} {currency}。',
       'FINANCE', false),

      ('finance.mortgage_payment_due', 'en',
       'Mortgage payment due in {days} days: {amount} {currency} for {property_name}. Lender: {lender_name}.',
       'FINANCE', false),
      ('finance.mortgage_payment_due', 'zh',
       '{property_name}按揭还款将在{days}天后到期：{amount} {currency}，贷款方：{lender_name}。',
       'FINANCE', false)
    ON CONFLICT (key, locale) DO NOTHING;
  `);


  // ── License renewal alerts — is_machine_translated = false (compliance) ───────
  // Driven by ent_license_renewals.renewal_alert_days_before (default 90).

  pgm.sql(`
    INSERT INTO i18n_translations (key, locale, value, module, is_machine_translated)
    VALUES
      ('license.renewal_alert_90d', 'en',
       'License renewal due in 90 days: {license_type} for {entity_name}. Expiry: {expiry_date}.',
       'BAR', false),
      ('license.renewal_alert_90d', 'zh',
       '{entity_name}的{license_type}将在90天后到期，到期日：{expiry_date}。请提前办理续期。',
       'BAR', false),

      ('license.renewal_alert_30d', 'en',
       'License renewal overdue — 30 days remaining: {license_type} for {entity_name}. Act now.',
       'BAR', false),
      ('license.renewal_alert_30d', 'zh',
       '紧急：{entity_name}的{license_type}仅剩30天到期，请立即办理续期。',
       'BAR', false),

      ('license.renewal_alert_7d', 'en',
       'URGENT — License expires in 7 days: {license_type} for {entity_name}. Expiry: {expiry_date}.',
       'BAR', false),
      ('license.renewal_alert_7d', 'zh',
       '紧急警告：{entity_name}的{license_type}将在7天后过期（{expiry_date}）。请立即处理。',
       'BAR', false),

      ('license.status.active',          'en', 'Active',           'BAR', false),
      ('license.status.active',          'zh', '有效',              'BAR', false),
      ('license.status.pending_renewal', 'en', 'Pending Renewal',  'BAR', false),
      ('license.status.pending_renewal', 'zh', '待续期',             'BAR', false),
      ('license.status.expired',         'en', 'Expired',          'BAR', false),
      ('license.status.expired',         'zh', '已过期',             'BAR', false),
      ('license.status.revoked',         'en', 'Revoked',          'BAR', false),
      ('license.status.revoked',         'zh', '已撤销',             'BAR', false)
    ON CONFLICT (key, locale) DO NOTHING;
  `);


  // ── Succession document type labels — is_machine_translated = false (legal) ───
  // Maps to fam_succession_documents.document_type enum values.

  pgm.sql(`
    INSERT INTO i18n_translations (key, locale, value, module, is_machine_translated)
    VALUES
      ('succession.document_type.will',               'en', 'Last Will and Testament',  'FINANCE', false),
      ('succession.document_type.will',               'zh', '遗嘱',                      'FINANCE', false),
      ('succession.document_type.trust',              'en', 'Trust Deed',               'FINANCE', false),
      ('succession.document_type.trust',              'zh', '信托契约',                   'FINANCE', false),
      ('succession.document_type.power_of_attorney',  'en', 'Power of Attorney',        'FINANCE', false),
      ('succession.document_type.power_of_attorney',  'zh', '授权委托书',                 'FINANCE', false),
      ('succession.document_type.letter_of_wishes',   'en', 'Letter of Wishes',         'FINANCE', false),
      ('succession.document_type.letter_of_wishes',   'zh', '意愿书',                    'FINANCE', false),
      ('succession.document_type.insurance_policy',   'en', 'Insurance Policy',         'FINANCE', false),
      ('succession.document_type.insurance_policy',   'zh', '保险单',                    'FINANCE', false),
      ('succession.document_type.share_certificate',  'en', 'Share Certificate',        'FINANCE', false),
      ('succession.document_type.share_certificate',  'zh', '股票证书',                   'FINANCE', false)
    ON CONFLICT (key, locale) DO NOTHING;
  `);


  // ── Property maintenance labels ──────────────────────────────────────────────
  // Maps to prop_maintenance_requests enums: maintenance_status, maintenance_priority,
  // maintenance_category.

  pgm.sql(`
    INSERT INTO i18n_translations (key, locale, value, module, is_machine_translated)
    VALUES
      -- Status
      ('maintenance.status.pending',     'en', 'Pending',     'PROPERTIES', false),
      ('maintenance.status.pending',     'zh', '待处理',        'PROPERTIES', true),
      ('maintenance.status.assigned',    'en', 'Assigned',    'PROPERTIES', false),
      ('maintenance.status.assigned',    'zh', '已分配',        'PROPERTIES', true),
      ('maintenance.status.in_progress', 'en', 'In Progress', 'PROPERTIES', false),
      ('maintenance.status.in_progress', 'zh', '进行中',        'PROPERTIES', true),
      ('maintenance.status.completed',   'en', 'Completed',   'PROPERTIES', false),
      ('maintenance.status.completed',   'zh', '已完成',        'PROPERTIES', true),
      ('maintenance.status.cancelled',   'en', 'Cancelled',   'PROPERTIES', false),
      ('maintenance.status.cancelled',   'zh', '已取消',        'PROPERTIES', true),

      -- Priority
      ('maintenance.priority.low',       'en', 'Low',         'PROPERTIES', false),
      ('maintenance.priority.low',       'zh', '低',           'PROPERTIES', true),
      ('maintenance.priority.medium',    'en', 'Medium',      'PROPERTIES', false),
      ('maintenance.priority.medium',    'zh', '中',           'PROPERTIES', true),
      ('maintenance.priority.high',      'en', 'High',        'PROPERTIES', false),
      ('maintenance.priority.high',      'zh', '高',           'PROPERTIES', true),
      ('maintenance.priority.emergency', 'en', 'Emergency',   'PROPERTIES', false),
      ('maintenance.priority.emergency', 'zh', '紧急',          'PROPERTIES', false),

      -- Category
      ('maintenance.category.plumbing',     'en', 'Plumbing',     'PROPERTIES', false),
      ('maintenance.category.plumbing',     'zh', '水管',           'PROPERTIES', true),
      ('maintenance.category.electrical',   'en', 'Electrical',   'PROPERTIES', false),
      ('maintenance.category.electrical',   'zh', '电气',           'PROPERTIES', true),
      ('maintenance.category.structural',   'en', 'Structural',   'PROPERTIES', false),
      ('maintenance.category.structural',   'zh', '结构',           'PROPERTIES', true),
      ('maintenance.category.appliance',    'en', 'Appliance',    'PROPERTIES', false),
      ('maintenance.category.appliance',    'zh', '家电',           'PROPERTIES', true),
      ('maintenance.category.landscaping',  'en', 'Landscaping',  'PROPERTIES', false),
      ('maintenance.category.landscaping',  'zh', '园艺',           'PROPERTIES', true),
      ('maintenance.category.security',     'en', 'Security',     'PROPERTIES', false),
      ('maintenance.category.security',     'zh', '安保',           'PROPERTIES', true),
      ('maintenance.category.cleaning',     'en', 'Cleaning',     'PROPERTIES', false),
      ('maintenance.category.cleaning',     'zh', '清洁',           'PROPERTIES', true),
      ('maintenance.category.general',      'en', 'General',      'PROPERTIES', false),
      ('maintenance.category.general',      'zh', '一般维修',        'PROPERTIES', true)
    ON CONFLICT (key, locale) DO NOTHING;
  `);


  // ── Lease status labels ──────────────────────────────────────────────────────
  // Maps to prop_lease_agreements.lease_status enum.

  pgm.sql(`
    INSERT INTO i18n_translations (key, locale, value, module, is_machine_translated)
    VALUES
      ('lease.status.draft',       'en', 'Draft',       'PROPERTIES', false),
      ('lease.status.draft',       'zh', '草稿',          'PROPERTIES', true),
      ('lease.status.active',      'en', 'Active',      'PROPERTIES', false),
      ('lease.status.active',      'zh', '有效',          'PROPERTIES', true),
      ('lease.status.expired',     'en', 'Expired',     'PROPERTIES', false),
      ('lease.status.expired',     'zh', '已过期',         'PROPERTIES', true),
      ('lease.status.terminated',  'en', 'Terminated',  'PROPERTIES', false),
      ('lease.status.terminated',  'zh', '已终止',         'PROPERTIES', true),
      ('lease.status.renewed',     'en', 'Renewed',     'PROPERTIES', false),
      ('lease.status.renewed',     'zh', '已续期',         'PROPERTIES', true)
    ON CONFLICT (key, locale) DO NOTHING;
  `);


  // ── Members Club chip float alerts — is_machine_translated = false ───────────
  // Driven by ent_chip_float_sessions. Any cash-handling alert must be manual.

  pgm.sql(`
    INSERT INTO i18n_translations (key, locale, value, module, is_machine_translated)
    VALUES
      ('alert.chip_float.session_opened', 'en',
       'Members Club chip float session opened: {float_amount} {currency} at {opened_at}.',
       'BAR', false),
      ('alert.chip_float.session_opened', 'zh',
       '会员俱乐部筹码浮动会话已开启：{opened_at}，金额{float_amount} {currency}。',
       'BAR', false),

      ('alert.chip_float.session_closed', 'en',
       'Members Club chip float session closed. Float: {float_amount}, Closing: {closing_amount} {currency}. Variance: {variance}.',
       'BAR', false),
      ('alert.chip_float.session_closed', 'zh',
       '会员俱乐部筹码浮动会话已关闭。浮动：{float_amount}，结算：{closing_amount} {currency}，差额：{variance}。',
       'BAR', false),

      ('alert.chip_float.variance_detected', 'en',
       'CASH VARIANCE DETECTED — Members Club chip float: expected {float_amount}, counted {closing_amount} {currency}. Difference: {variance}. Requires manager sign-off.',
       'BAR', false),
      ('alert.chip_float.variance_detected', 'zh',
       '现金差异警告：会员俱乐部筹码浮动不符，预期{float_amount}，实际{closing_amount} {currency}，差额{variance}。需主管签字确认。',
       'BAR', false)
    ON CONFLICT (key, locale) DO NOTHING;
  `);


  // ── Bar entity tag labels ────────────────────────────────────────────────────
  // Maps to ent_bar_transactions.entity_tag enum (BAR | MEMBERS_CLUB).
  // These appear on every transaction row — the sole P&L separator.

  pgm.sql(`
    INSERT INTO i18n_translations (key, locale, value, module, is_machine_translated)
    VALUES
      ('bar.entity_tag.bar',          'en', 'Bar',          'BAR', false),
      ('bar.entity_tag.bar',          'zh', '酒吧',           'BAR', true),
      ('bar.entity_tag.members_club', 'en', 'Members Club', 'BAR', false),
      ('bar.entity_tag.members_club', 'zh', '会员俱乐部',      'BAR', true)
    ON CONFLICT (key, locale) DO NOTHING;
  `);


  // ── IMS movement type labels ─────────────────────────────────────────────────
  // Maps to ims_stock_movements.movement_type enum.

  pgm.sql(`
    INSERT INTO i18n_translations (key, locale, value, module, is_machine_translated)
    VALUES
      ('ims.movement_type.receive',    'en', 'Receive',    'IMS', false),
      ('ims.movement_type.receive',    'zh', '入库',         'IMS', true),
      ('ims.movement_type.issue',      'en', 'Issue',      'IMS', false),
      ('ims.movement_type.issue',      'zh', '出库',         'IMS', true),
      ('ims.movement_type.transfer',   'en', 'Transfer',   'IMS', false),
      ('ims.movement_type.transfer',   'zh', '调拨',         'IMS', true),
      ('ims.movement_type.adjust',     'en', 'Adjustment', 'IMS', false),
      ('ims.movement_type.adjust',     'zh', '库存调整',      'IMS', true),
      ('ims.movement_type.dispose',    'en', 'Dispose',    'IMS', false),
      ('ims.movement_type.dispose',    'zh', '报废',         'IMS', true),
      ('ims.movement_type.audit',      'en', 'Audit Count','IMS', false),
      ('ims.movement_type.audit',      'zh', '盘点',         'IMS', true)
    ON CONFLICT (key, locale) DO NOTHING;
  `);


  // ── JABCO project status labels ──────────────────────────────────────────────
  // Maps to jabco_projects.status enum.

  pgm.sql(`
    INSERT INTO i18n_translations (key, locale, value, module, is_machine_translated)
    VALUES
      ('jabco.project_status.planning',    'en', 'Planning',    'JABCO', false),
      ('jabco.project_status.planning',    'zh', '规划中',        'JABCO', true),
      ('jabco.project_status.active',      'en', 'Active',      'JABCO', false),
      ('jabco.project_status.active',      'zh', '进行中',        'JABCO', true),
      ('jabco.project_status.on_hold',     'en', 'On Hold',     'JABCO', false),
      ('jabco.project_status.on_hold',     'zh', '暂停',          'JABCO', true),
      ('jabco.project_status.completed',   'en', 'Completed',   'JABCO', false),
      ('jabco.project_status.completed',   'zh', '已完成',         'JABCO', true),
      ('jabco.project_status.cancelled',   'en', 'Cancelled',   'JABCO', false),
      ('jabco.project_status.cancelled',   'zh', '已取消',         'JABCO', true),

      -- Variation Order status
      ('jabco.vo_status.draft',            'en', 'Draft',       'JABCO', false),
      ('jabco.vo_status.draft',            'zh', '草稿',          'JABCO', true),
      ('jabco.vo_status.submitted',        'en', 'Submitted',   'JABCO', false),
      ('jabco.vo_status.submitted',        'zh', '已提交',         'JABCO', true),
      ('jabco.vo_status.approved',         'en', 'Approved',    'JABCO', false),
      ('jabco.vo_status.approved',         'zh', '已批准',         'JABCO', true),
      ('jabco.vo_status.rejected',         'en', 'Rejected',    'JABCO', false),
      ('jabco.vo_status.rejected',         'zh', '已拒绝',         'JABCO', true)
    ON CONFLICT (key, locale) DO NOTHING;
  `);
}


export async function down(pgm: MigrationBuilder): Promise<void> {
  // Delete all keys seeded by this migration.
  // Keyed by prefix to catch any additions within the same migration file.
  pgm.sql(`
    DELETE FROM i18n_translations
    WHERE key LIKE 'common.module.%'
       OR key LIKE 'common.status.%'
       OR key LIKE 'finance.%'
       OR key LIKE 'license.%'
       OR key LIKE 'succession.%'
       OR key LIKE 'maintenance.%'
       OR key LIKE 'lease.%'
       OR key LIKE 'alert.chip_float.%'
       OR key LIKE 'bar.entity_tag.%'
       OR key LIKE 'ims.movement_type.%'
       OR key LIKE 'jabco.project_status.%'
       OR key LIKE 'jabco.vo_status.%';
  `);
}
