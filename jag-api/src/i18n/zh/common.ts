// JAG Platform — Mandarin Chinese (zh) common strings
// Manual translation required for all financial, legal, compliance, and alert strings.
// Navigation labels may use machine translation.
// Default locale for wife's account (preferred_language = 'zh').
// Traditional/Simplified: Simplified Chinese used throughout (standard for T&T Chinese community).

import type { LocaleCommon } from '../en/common';

export const zh_common: LocaleCommon = {

  // ── API error messages ────────────────────────────────────────────────────────
  errors: {
    UNAUTHORIZED:         '需要身份验证，请登录。',
    FORBIDDEN:            '您没有执行此操作的权限。',
    NOT_FOUND:            '未找到所请求的记录。',
    VALIDATION_ERROR:     '一个或多个字段验证失败，请检查您的输入。',
    CONFLICT:             '此记录已存在或与现有数据冲突。',
    SERVER_ERROR:         '发生意外错误，请重试或联系支持团队。',
    IDEMPOTENCY_CONFLICT: '检测到重复提交，已忽略。',
    TENANT_MISMATCH:      '访问被拒绝：该记录不属于您的组织。',
    RATE_LIMITED:         '请求过多，请稍后重试。',
    MIGRATION_PENDING:    '数据库迁移正在进行，请稍后重试。',
  },

  // ── Common status labels ──────────────────────────────────────────────────────
  status: {
    ACTIVE:          '活跃',
    INACTIVE:        '停用',
    PENDING:         '待处理',
    PENDING_REVIEW:  '待审核',
    APPROVED:        '已批准',
    REJECTED:        '已拒绝',
    CANCELLED:       '已取消',
    COMPLETED:       '已完成',
    IN_PROGRESS:     '进行中',
    DRAFT:           '草稿',
    PAID:            '已付款',
    OVERDUE:         '逾期',
    FAILED:          '失败',
    PROCESSING:      '处理中',
  },

  // ── Financial labels ──────────────────────────────────────────────────────────
  finance: {
    currency: {
      TTD: '特立尼达和多巴哥元',
      USD: '美元',
      CNY: '人民币',
      GBP: '英镑',
      EUR: '欧元',
      CAD: '加拿大元',
    },
    accountType: {
      CHEQUE:      '支票账户',
      SAVINGS:     '储蓄账户',
      CREDIT_CARD: '信用卡',
      MORTGAGE:    '按揭贷款',
      LOAN:        '贷款',
      INVESTMENT:  '投资账户',
      PENSION:     '养老金／退休账户',
      CRYPTO:      '加密货币',
      CASH:        '现金',
      OTHER:       '其他',
    },
    transactionType: {
      DEBIT:         '借记',
      CREDIT:        '贷记',
      TRANSFER_OUT:  '转出',
      TRANSFER_IN:   '转入',
      FX_CONVERSION: '外汇兑换',
    },
    loanType: {
      MORTGAGE:      '按揭贷款',
      BUSINESS_LOAN: '商业贷款',
      PERSONAL_LOAN: '个人贷款',
      CREDIT_CARD:   '信用卡',
      OVERDRAFT:     '透支额度',
    },
    netWorth:         '净资产',
    totalAssets:      '总资产',
    totalLiabilities: '总负债',
  },

  // ── Notifications — Tier 1 (immediate / critical) ────────────────────────────
  notifications: {
    tier1: {
      SUCCESSION_ACTIVATED: {
        title:   '继承计划已启动',
        body:    'JAG平台继承计划已启动，紧急指定人访问权限已开通。',
      },
      AUTH_FAILED_REPEATED: {
        title:   '多次登录失败',
        body:    '账户 {{email}} 检测到 {{count}} 次连续登录失败。',
      },
      BACKUP_FAILED: {
        title:   '备份失败',
        body:    '每夜备份任务于 {{time}} 失败，请立即处理。',
      },
      MIGRATION_FAILED: {
        title:   '数据库迁移失败',
        body:    '{{database}} 上的迁移文件 {{file}} 执行失败，部署已中止。',
      },
      PAYMENT_FAILED: {
        title:   '付款处理失败',
        body:    '账户 {{account}} 的 {{amount}} {{currency}} 付款无法处理。',
      },
      EVENT_DISPATCH_FAILED: {
        title:   '事件派发失败',
        body:    '{{count}} 个事件在3次重试后仍未送达，需要人工处理。',
      },
    },

    // ── Tier 2 (daily 7am digest) ────────────────────────────────────────────
    tier2: {
      RENT_DUE_REMINDER: {
        title:   '租金到期提醒',
        body:    '{{tenant}} 的 {{amount}} TTD 租金将于 {{date}} 到期。',
      },
      DOCUMENT_EXPIRING: {
        title:   '文件即将过期',
        body:    '《{{document_title}}》将于 {{expiry_date}} 到期，请及时审查并续期。',
      },
      LOW_STOCK_ALERT: {
        title:   '库存不足警告',
        body:    '{{location}} 的物品"{{item_name}}"低于最低库存（剩余 {{qty}} 件）。',
      },
      INVOICE_OVERDUE: {
        title:   '发票逾期',
        body:    '{{vendor}} 的发票 {{invoice_number}}（金额 {{amount}} TTD）已逾期 {{days}} 天。',
      },
      AI_REVIEW_PENDING: {
        title:   '银行对账单需要审核',
        body:    '从 {{bank}} 提取的 {{count}} 笔交易需要您在过账前进行审核。',
      },
    },

    // ── Tier 3 (weekly Monday digest) ────────────────────────────────────────
    tier3: {
      WEEKLY_SUMMARY: {
        title:   '每周平台摘要',
        body:    '截至 {{date}} 的一周：已过账 {{transaction_count}} 笔交易，{{review_count}} 项待审核。',
      },
      SUCCESSION_RENEWAL_DUE: {
        title:   '年度继承凭证续期提醒',
        body:    '年度继承计划凭证续期应于 {{due_date}} 前完成，请办理续期手续。',
      },
      LICENCE_RENEWAL_DUE: {
        title:   '执照续期提醒',
        body:    '{{entity}} 的 {{licence_name}} 应于 {{due_date}} 前续期。',
      },
    },
  },

  // ── Alert strings ─────────────────────────────────────────────────────────────
  alerts: {
    SUCCESSION_RENEWAL_OVERDUE:
      '继承计划年度续期已逾期，请立即审查并确认凭证。',
    DOCUMENT_CLASSIFIED:
      '此文件为机密文件，请按照JAG数据分类政策处理。',
    AI_CONFIDENCE_LOW:
      '此交易的提取置信度较低（{{score}}%），请在批准前核实。',
    FX_RATE_STALE:
      '{{pair}} 的汇率已有 {{days}} 天未更新，结果可能未反映当前市场汇率。',
    MORTGAGE_PAYMENT_DUE:
      '{{property}} 的 {{amount}} {{currency}} 按揭还款将于 {{date}} 到期。',
    OFFLINE_SYNC_CONFLICT:
      '记录 {{record_id}} 的离线同步发生冲突，需要人工处理。',
    EXTERNAL_ESCALATION_CONSENT:
      '此文件将被发送至外部AI服务处理。未经您批准，银行数据不会离开您的基础设施。',
  },

  // ── Family / succession labels ────────────────────────────────────────────────
  family: {
    relationship: {
      SELF:     '本人',
      WIFE:     '配偶',
      DAUGHTER: '女儿',
      FATHER:   '父亲',
      BROTHER:  '兄弟',
      OTHER:    '其他',
    },
    documentType: {
      WILL:                '遗嘱',
      TRUST:               '信托契约',
      POWER_OF_ATTORNEY:   '授权书',
      INSURANCE_POLICY:    '保险单',
      TITLE_DEED:          '房产证',
      SHARE_CERTIFICATE:   '股份证书',
      BANK_MANDATE:        '银行授权书',
      COMPANY_RESOLUTION:  '公司决议',
      ADVANCE_DIRECTIVE:   '预立医疗指示／生前遗嘱',
      OTHER:               '其他法律文件',
    },
  },

};
