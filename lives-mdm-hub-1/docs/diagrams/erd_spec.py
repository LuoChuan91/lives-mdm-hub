"""Entity-relationship model of the to-be solution (one source for every ERD output).

Production home of each group:
  settings   SharePoint lists the MDM team edits (fields, rules, business units, people)
  workflow   SharePoint lists written by Power Apps and Power Automate
  sap        SAP Business One master data tables (OCRD, OITM, OPRC)
  demand     customer orders from SAP B1, the shared mailbox, and the duplicate register

The prototype in assets/engine.js keeps the same data in browser storage.
"""

GROUPS = [
    ("settings", "Settings", "SharePoint lists the MDM team edits"),
    ("workflow", "Requests and approvals", "SharePoint lists, Power Apps, Power Automate"),
    ("sap", "SAP Business One master data", "Loaded through the Data Transfer Workbench"),
    ("demand", "Orders, mailbox and data quality", "Feeds the regional view in Power BI"),
]

# key: "PK", "FK", "PK, FK" or ""; note: short hint shown in grey; sensitive fields are masked by role
ENTITIES = [
    ("BUSINESS_UNIT", "settings", None, [
        ("PK", "bu_code", "SPD, QTS, QTG …"),
        ("", "name", ""),
        ("FK", "head_person_id", "approves as BU head"),
        ("", "active", ""),
    ]),
    ("PERSON", "settings", None, [
        ("PK", "person_id", ""),
        ("", "name", ""),
        ("", "job_title", ""),
        ("", "approver_role", "Finance, QA/RA, MDM …"),
        ("FK", "bu_code", "blank until a unit exists"),
    ]),
    ("FIELD_DEFINITION", "settings", None, [
        ("PK", "field_id", ""),
        ("", "domain", "customer, item, vendor, cost centre"),
        ("", "label", ""),
        ("", "data_type", ""),
        ("", "required", ""),
        ("", "show_if", "e.g. category = IVD reagent"),
        ("", "sensitive", "masked by role"),
        ("", "active", ""),
    ]),
    ("APPROVAL_RULE", "settings", None, [
        ("PK", "rule_id", ""),
        ("", "domain", ""),
        ("", "condition", "e.g. credit terms requested"),
        ("", "approver_role", ""),
        ("", "stage", "same stage = in parallel"),
        ("", "active", ""),
    ]),
    ("MDM_REQUEST", "workflow", None, [
        ("PK", "request_id", "REQ-1001"),
        ("", "domain", ""),
        ("", "request_type", "new or extend"),
        ("FK", "requester_id", ""),
        ("FK", "bu_code", ""),
        ("FK", "batch_id", "SAP import file"),
        ("", "status", "In approval, MDM check …"),
        ("", "duplicate_decision", "none, extend, override"),
        ("", "duplicate_score", ""),
        ("", "sap_code", "assigned at MDM check"),
        ("", "submitted_at", ""),
        ("", "completed_at", ""),
    ]),
    ("REQUEST_FIELD_VALUE", "workflow", None, [
        ("PK, FK", "request_id", ""),
        ("PK, FK", "field_id", ""),
        ("", "value", "masked if sensitive"),
    ]),
    ("APPROVAL_TASK", "workflow", None, [
        ("PK", "task_id", ""),
        ("FK", "request_id", ""),
        ("FK", "rule_id", ""),
        ("FK", "assignee_id", ""),
        ("", "status", "Pending, Approved, Info requested"),
        ("", "due_at", "2 working days"),
        ("", "reminders", ""),
        ("", "escalated", ""),
        ("", "decided_at", ""),
        ("", "comment", ""),
    ]),
    ("AUDIT_EVENT", "workflow", None, [
        ("PK", "event_id", "append-only"),
        ("", "occurred_at", ""),
        ("FK", "actor_id", "person or system"),
        ("FK", "request_id", ""),
        ("", "action", "Submitted, Viewed sensitive …"),
        ("", "detail", ""),
    ]),
    ("IMPORT_BATCH", "workflow", None, [
        ("PK", "batch_id", ""),
        ("", "dtw_object", "oBusinessPartners, oItems …"),
        ("FK", "created_by", ""),
        ("", "created_at", ""),
        ("", "imported_at", ""),
    ]),
    ("BUSINESS_PARTNER", "sap", "OCRD", [
        ("PK", "CardCode", "C-SG-0018"),
        ("", "CardName", ""),
        ("", "CardType", "customer or vendor"),
        ("", "Country, City", ""),
        ("", "FederalTaxID", ""),
        ("", "PayTermsGrpCode", ""),
        ("", "CreditLimit", "sensitive"),
        ("", "BankAccount", "sensitive"),
        ("FK", "U_SourceRequest", "request that created it"),
    ]),
    ("ITEM", "sap", "OITM", [
        ("PK", "ItemCode", "A-1001"),
        ("", "ItemName", ""),
        ("", "ProductLine", "A, B or C"),
        ("", "Manufacturer, U_MfrPartNo", ""),
        ("", "U_LicenceNo", "regulated items"),
        ("", "SalesUnit, U_ListPriceSGD", ""),
        ("FK", "U_SourceRequest", ""),
    ]),
    ("COST_CENTRE", "sap", "OPRC", [
        ("PK", "CenterCode", "CC-QTS-SG-MKT"),
        ("", "CenterName", ""),
        ("", "InWhichDimension", ""),
        ("", "EffectiveFrom", ""),
        ("FK", "U_SourceRequest", ""),
    ]),
    ("PURCHASE_ORDER", "demand", None, [
        ("PK", "po_line_id", ""),
        ("", "po_date", ""),
        ("FK", "CardCode", "customer"),
        ("FK", "ItemCode", ""),
        ("", "country", "from the customer"),
        ("", "qty, value_sgd", ""),
        ("", "customer_po_ref", ""),
    ]),
    ("INBOUND_MESSAGE", "demand", None, [
        ("PK", "msg_id", ""),
        ("", "received_at", ""),
        ("", "subject, body", ""),
        ("", "predicted_type", "order, enquiry, setup, follow-up"),
        ("", "confidence", ""),
        ("FK", "CardCode", "sender, if known"),
        ("FK", "po_line_id", "order emails"),
        ("FK", "request_id", "setup emails"),
    ]),
    ("DUPLICATE_PAIR", "demand", None, [
        ("PK", "pair_id", ""),
        ("FK", "record_a", ""),
        ("FK", "record_b", ""),
        ("", "score", "0 to 100"),
        ("", "band", "likely 90+, possible 75–89"),
        ("", "decision", "merge or keep both"),
    ]),
]

# (referenced entity, its end, entity holding the foreign key, its end, foreign key attribute, verb)
# Crow's foot ends: "one" (exactly one), "zero_one", "many" (zero or many), "one_many" (one or many)
RELATIONSHIPS = [
    ("BUSINESS_UNIT", "zero_one", "PERSON", "many", "bu_code", "has members"),
    ("PERSON", "one", "BUSINESS_UNIT", "many", "head_person_id", "heads"),
    ("PERSON", "one", "MDM_REQUEST", "many", "requester_id", "submits"),
    ("BUSINESS_UNIT", "one", "MDM_REQUEST", "many", "bu_code", "owns"),
    ("FIELD_DEFINITION", "one", "REQUEST_FIELD_VALUE", "many", "field_id", "defines"),
    ("MDM_REQUEST", "one", "REQUEST_FIELD_VALUE", "one_many", "request_id", "holds"),
    ("MDM_REQUEST", "one", "APPROVAL_TASK", "many", "request_id", "is routed to"),
    ("APPROVAL_RULE", "zero_one", "APPROVAL_TASK", "many", "rule_id", "creates"),
    ("PERSON", "one", "APPROVAL_TASK", "many", "assignee_id", "decides"),
    ("MDM_REQUEST", "zero_one", "AUDIT_EVENT", "many", "request_id", "is logged in"),
    ("PERSON", "zero_one", "AUDIT_EVENT", "many", "actor_id", "performs"),
    ("IMPORT_BATCH", "zero_one", "MDM_REQUEST", "one_many", "batch_id", "carries"),
    ("MDM_REQUEST", "zero_one", "BUSINESS_PARTNER", "zero_one", "U_SourceRequest", "creates"),
    ("MDM_REQUEST", "zero_one", "ITEM", "zero_one", "U_SourceRequest", "creates"),
    ("MDM_REQUEST", "zero_one", "COST_CENTRE", "zero_one", "U_SourceRequest", "creates"),
    ("MDM_REQUEST", "zero_one", "INBOUND_MESSAGE", "many", "request_id", "started by"),
    ("BUSINESS_PARTNER", "one", "PURCHASE_ORDER", "many", "CardCode", "places"),
    ("ITEM", "one", "PURCHASE_ORDER", "many", "ItemCode", "is ordered in"),
    ("BUSINESS_PARTNER", "zero_one", "INBOUND_MESSAGE", "many", "CardCode", "sends"),
    ("PURCHASE_ORDER", "zero_one", "INBOUND_MESSAGE", "zero_one", "po_line_id", "arrived as"),
    ("BUSINESS_PARTNER", "one", "DUPLICATE_PAIR", "many", "record_a", "is record A in"),
    ("BUSINESS_PARTNER", "one", "DUPLICATE_PAIR", "many", "record_b", "is record B in"),
]
