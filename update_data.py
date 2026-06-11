import os
import glob
import pandas as pd
import json
import numpy as np

def update_dashboard_data():
    # Find all Excel files in the current folder
    xlsx_files = glob.glob("*.xlsx")
    if not xlsx_files:
        print("Error: No Excel (.xlsx) file found in this folder.")
        print("Please export your CRM data as an Excel file and save it in this directory.")
        return

    # Select the newest file based on modification time
    latest_file = max(xlsx_files, key=os.path.getmtime)
    print(f"Reading latest CRM export: {latest_file}...")

    try:
        df = pd.read_excel(latest_file)
        
        # Replace NaNs with None for clean JSON serialization
        df = df.replace({np.nan: None})

        # Standardize date columns to strings
        datetime_cols = ['Created on', 'RFQ Date', 'Next Follow up']
        for col in datetime_cols:
            if col in df.columns:
                df[col] = df[col].apply(
                    lambda x: x.strftime('%Y-%m-%d %H:%M:%S') 
                    if pd.notna(x) and hasattr(x, 'strftime') else None
                )

        # Convert to records format
        records = df.to_dict(orient='records')

        # Save to leads_data.json
        output_file = "leads_data.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(records, f, indent=2, ensure_ascii=False)

        print(f"Success: Processed {len(records)} records and updated {output_file}!")

    except Exception as e:
        print(f"Error processing Excel file: {e}")

if __name__ == "__main__":
    update_dashboard_data()
