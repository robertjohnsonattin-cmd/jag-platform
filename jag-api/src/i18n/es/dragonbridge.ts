// DragonBridge Spanish (es) translations — medium scope.
// Covers: status labels, document section headers, PDF labels, email notification templates.
// Full platform Spanish deferred to Phase 6. Machine translation used for navigation only;
// all financial, legal, and status strings below are manually verified.

export const db_es = {

  // ── Quote status labels ──────────────────────────────────────────────────────
  quoteStatus: {
    DRAFT:     'Borrador',
    SENT:      'Enviada',
    ACCEPTED:  'Aceptada',
    EXPIRED:   'Vencida',
    CANCELLED: 'Cancelada',
  },

  // ── Order status labels ──────────────────────────────────────────────────────
  orderStatus: {
    CONFIRMED:     'Confirmado',
    IN_PRODUCTION: 'En producción',
    READY_TO_SHIP: 'Listo para envío',
    IN_TRANSIT:    'En tránsito',
    CUSTOMS:       'En aduana',
    DELIVERED:     'Entregado',
    CANCELLED:     'Cancelado',
  },

  // ── Shipment status labels ───────────────────────────────────────────────────
  shipmentStatus: {
    BOOKING:    'Reserva',
    LOADING:    'Carga',
    IN_TRANSIT: 'En tránsito',
    ARRIVED:    'Llegado',
    CLEARED:    'Despachado',
  },

  // ── Invoice status labels ────────────────────────────────────────────────────
  invoiceStatus: {
    DRAFT:  'Borrador',
    ISSUED: 'Emitida',
    PAID:   'Pagada',
    VOID:   'Anulada',
  },

  // ── Invoice type labels ──────────────────────────────────────────────────────
  invoiceType: {
    DEPOSIT:    'Depósito',
    FINAL:      'Final',
    AGENCY_FEE: 'Honorarios de gestión',
  },

  // ── Delivery status labels ───────────────────────────────────────────────────
  deliveryStatus: {
    SCHEDULED:        'Programada',
    OUT_FOR_DELIVERY: 'En camino',
    DELIVERED:        'Entregada',
    FAILED:           'No entregada',
  },

  // ── Reconciliation status labels ─────────────────────────────────────────────
  reconciliationStatus: {
    PENDING:        'Pendiente',
    AUTO_CLOSED:    'Cerrada automáticamente',
    PENDING_REVIEW: 'En revisión',
    APPROVED:       'Aprobada',
    INVOICED:       'Facturada',
  },

  // ── Quote PDF section headers ────────────────────────────────────────────────
  quotePdf: {
    title:              'COTIZACIÓN',
    quoteNumber:        'Número de cotización',
    date:               'Fecha',
    validUntil:         'Válida hasta',
    preparedFor:        'Preparada para',
    clientRef:          'Referencia del cliente',
    tableHeaderProduct: 'Producto',
    tableHeaderHsCode:  'Código HS',
    tableHeaderQty:     'Cantidad',
    tableHeaderUnit:    'Unidad',
    tableHeaderUnitCostCny: 'Costo unit. (CNY)',
    tableHeaderDuty:    'Arancel estimado (TTD)',
    tableHeaderVat:     'IVA estimado (TTD)',
    tableHeaderLanded:  'Costo neto estimado (TTD)',
    sectionFreight:     'Flete estimado',
    sectionInsurance:   'Seguro estimado',
    sectionDelivery:    'Entrega local estimada',
    sectionAgencyFee:   'Honorarios de gestión',
    sectionMargin:      'Margen comercial',
    sectionTotal:       'TOTAL ESTIMADO (TTD)',
    sectionSubtotal:    'Subtotal',
    notes:              'Notas',
    terms:              'Términos y condiciones',
    termsBody:          'Este presupuesto es una estimación basada en las tasas de cambio y aranceles vigentes a la fecha de emisión. Los costos finales se determinarán tras el despacho aduanal.',
    footerContact:      'Para consultas, comuníquese con su representante de DragonBridge.',
    roleImporter:       'Importador de registro',
    roleAgent:          'Agente de compras',
    fxRateNote:         'Tipos de cambio aplicados: 1 USD = {{usd_ttd}} TTD · 1 USD = {{cny_usd}} CNY',
  },

  // ── Invoice PDF section headers ──────────────────────────────────────────────
  invoicePdf: {
    title:           'FACTURA',
    invoiceNumber:   'Número de factura',
    orderNumber:     'Número de pedido',
    invoiceDate:     'Fecha de factura',
    dueDate:         'Fecha de vencimiento',
    billTo:          'Facturar a',
    description:     'Descripción',
    amount:          'Monto (TTD)',
    depositPaid:     'Depósito pagado',
    balanceDue:      'SALDO A PAGAR (TTD)',
    totalAmount:     'MONTO TOTAL (TTD)',
    paymentMethod:   'Método de pago',
    paymentStatus:   'Estado del pago',
    depositInvoice:  'Factura de depósito ({{pct}}%)',
    finalInvoice:    'Factura final — liquidación',
    agencyFeeInvoice:'Factura de honorarios de gestión',
    varianceNote:    'Nota de variación: El monto final refleja los costos reales de flete, seguro y arancel tras el despacho aduanal.',
    varianceAmount:  'Variación respecto a cotización',
    thankYou:        'Gracias por su pedido.',
  },

  // ── Email notification templates ─────────────────────────────────────────────
  emails: {
    quoteReady: {
      subject: 'Su cotización DragonBridge está lista — {{quote_number}}',
      greeting: 'Estimado/a {{client_name}},',
      body:     'Le informamos que su cotización número {{quote_number}} ha sido preparada y está lista para su revisión. El monto total estimado es {{total_ttd}} TTD, válida hasta el {{valid_until}}.',
      cta:      'Comuníquese con su representante para aceptar o solicitar cambios.',
      footer:   'DragonBridge · División de comercio internacional de Johnson Attin Group',
    },
    orderConfirmed: {
      subject: 'Pedido confirmado — {{order_number}}',
      greeting: 'Estimado/a {{client_name}},',
      body:     'Hemos recibido la aceptación de su cotización. Su pedido {{order_number}} ha sido confirmado. Para proceder, le solicitamos el pago del depósito según la factura adjunta.',
      depositNote: 'Depósito requerido: {{deposit_amount}} TTD ({{deposit_pct}}% del total)',
      footer:   'DragonBridge · División de comercio internacional de Johnson Attin Group',
    },
    shipmentUpdate: {
      subject: 'Actualización de envío — Pedido {{order_number}}',
      greeting: 'Estimado/a {{client_name}},',
      statusUpdate: 'El estado de su envío ha cambiado a: {{status}}',
      etaNote:  'Fecha estimada de llegada: {{eta}}',
      footer:   'DragonBridge · División de comercio internacional de Johnson Attin Group',
    },
    customsCleared: {
      subject: 'Mercancía despachada de aduana — Pedido {{order_number}}',
      greeting: 'Estimado/a {{client_name}},',
      body:     'Su mercancía ha sido despachada de la Autoridad de Aduanas de Trinidad y Tobago. Le enviaremos su factura final con el desglose de costos reales a la brevedad.',
      footer:   'DragonBridge · División de comercio internacional de Johnson Attin Group',
    },
    invoiceIssued: {
      subject: 'Nueva factura emitida — {{invoice_number}}',
      greeting: 'Estimado/a {{client_name}},',
      body:     'Se ha emitido la factura {{invoice_number}} por un monto de {{amount_ttd}} TTD. Saldo a pagar: {{balance_due}} TTD.',
      dueNote:  'Fecha de vencimiento: {{due_date}}',
      footer:   'DragonBridge · División de comercio internacional de Johnson Attin Group',
    },
    deliveryScheduled: {
      subject: 'Entrega programada — Pedido {{order_number}}',
      greeting: 'Estimado/a {{client_name}},',
      body:     'Su entrega ha sido programada para el {{scheduled_date}}. Nuestro equipo se comunicará con usted para confirmar los detalles.',
      footer:   'DragonBridge · División de comercio internacional de Johnson Attin Group',
    },
  },

} as const;

export type DbEsKeys = typeof db_es;
