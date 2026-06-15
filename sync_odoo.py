import os
import json
import xmlrpc.client
from datetime import datetime

# =====================================================================
# LOAD ENVIRONMENT VARIABLES FROM .ENV
# =====================================================================
# Simple helper to load .env file if it exists locally without external dependencies
if os.path.exists(".env"):
    with open(".env", "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, val = line.split("=", 1)
                # Strip potential surrounding quotes from values
                val = val.strip().strip('"').strip("'")
                os.environ[key.strip()] = val

# =====================================================================
# ODOO CONNECTION CONFIGURATION (LOADED SECURELY)
# =====================================================================
ODOO_URL = os.environ.get("ODOO_URL", "https://your-company.odoo.com")
ODOO_DB = os.environ.get("ODOO_DB", "your-database-name")
ODOO_USER = os.environ.get("ODOO_USER", "your-username-or-email")
ODOO_API_KEY = os.environ.get("ODOO_API_KEY", "your-api-key-or-password")

# =====================================================================
# FIELD MAPPING: ODOO TECHNICAL FIELDS -> DASHBOARD JSON FIELDS
# =====================================================================
# Below is the mapping from Odoo technical field names to the dashboard keys.
# Note: Custom fields in Odoo typically start with 'x_'. 
# Please check your Odoo settings or developer mode to verify field names.
FIELD_MAPPING = {
    'create_date': 'Created on',
    'source_id': 'Source',                  # Many2one -> resolved to name
    'x_studio_rfq_date': 'RFQ Date',
    'partner_name': 'Company Name',         # Or partner_id
    'name': 'Opportunity',
    'contact_name': 'Contact Name',
    'email_from': 'Email',
    'phone': 'Phone',                       # Standard Odoo phone field
    'user_id': 'Salesperson',               # Many2one -> resolved to name
    'x_studio_next_follow_up': 'Next Follow up',
    'x_studio_selection_field_2c7_1jm37ueas': 'Industry Segment',
    'x_studio_expected_rev': 'Revenue (Millions USD)',
    'x_studio_type': 'Opportunity Type',
    'expected_revenue': 'Expected Revenue',   # Odoo 19.0 uses expected_revenue instead of planned_revenue
    'stage_id': 'Stage',                    # Many2one -> resolved to name
    'probability': 'Won/Lost',              # Resolved via logic (100% -> "Won", else "Pending")
    'country_id': 'Country',                # Many2one -> resolved to name
    'state_id': 'State',                    # Many2one -> resolved to name
    'city': 'City',
    'date_closed': 'Closed Date',
    'date_deadline': 'Expected Closing'
}

def clean_many2one(value):
    """Odoo returns many2one fields as [id, name]. We extract the name."""
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        return value[1]
    return value

def format_date(date_str):
    """Converts standard Odoo UTC datetime strings (YYYY-MM-DD HH:MM:SS) if needed."""
    if not date_str:
        return None
    # Odoo datetime strings are already formatted as 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DD'
    return date_str

def sync_leads_from_odoo():
    print("=========================================")
    print("      SYNCING DATA FROM ODOO CRM         ")
    print("=========================================")
    
    if ODOO_URL == "https://your-company.odoo.com" or ODOO_API_KEY == "your-api-key-or-password":
        print("[ERROR] Please update Odoo connection details in sync_odoo.py first.")
        return

    try:
        # 1. Authenticate with Odoo
        print(f"Connecting to Odoo at {ODOO_URL}...")
        common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common')
        uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_API_KEY, {})
        if not uid:
            print("[ERROR] Authentication failed. Please check your credentials.")
            return
        print(f"Authentication successful! (User UID: {uid})")

        # 2. Fetch records from crm.lead
        models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object')
        fields_to_fetch = list(FIELD_MAPPING.keys())
        
        # We can add domain filters here if we want to only get recent leads or leads in certain stages
        # e.g., [('active', '=', True)]
        domain = []
        
        print("Fetching leads from crm.lead...")
        records = models.execute_kw(
            ODOO_DB, uid, ODOO_API_KEY,
            'crm.lead', 'search_read',
            [domain],
            {'fields': fields_to_fetch}
        )
        print(f"Retrieved {len(records)} leads from Odoo.")

        # 3. Process and Map fields to Dashboard Format
        processed_leads = []
        for rec in records:
            lead = {}
            for odoo_field, dashboard_key in FIELD_MAPPING.items():
                val = rec.get(odoo_field)
                
                # Apply special mapping/extraction logic
                if odoo_field in ['source_id', 'user_id', 'stage_id', 'country_id', 'state_id']:
                    val = clean_many2one(val)
                elif odoo_field in ['create_date', 'x_studio_rfq_date', 'x_studio_next_follow_up', 'date_closed', 'date_deadline']:
                    val = format_date(val)
                elif odoo_field == 'probability':
                    # Map probability to Won/Lost (e.g. 100% is Won, otherwise Pending or check stage name)
                    val = "Won" if val == 100 or rec.get('stage_id') == 'Won' else "Pending"
                
                lead[dashboard_key] = val
            
            processed_leads.append(lead)

        # 4. Save to leads_data.json
        output_file = "leads_data.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(processed_leads, f, indent=2, ensure_ascii=False)
            
        print(f"Success: Processed {len(processed_leads)} records and updated {output_file}!")

    except Exception as e:
        print(f"[ERROR] Sync failed: {e}")

if __name__ == "__main__":
    sync_leads_from_odoo()
