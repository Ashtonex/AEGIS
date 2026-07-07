import os
import re

schema_path = r'g:\work\ATMCAPPROJECTS\Mudekwa\AEGIS\imperium-api\migrations\002_imperium_schemas.sql'
with open(schema_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Naive parse to find CREATE TABLE blocks
tables = {}
matches = re.finditer(r'CREATE TABLE (\w+) \((.*?)\);', content, re.DOTALL)
for match in matches:
    table_name = match.group(1)
    columns_block = match.group(2)
    # just get the first word of each line as the column name
    columns = []
    for line in columns_block.split('\n'):
        line = line.strip()
        if not line or line.startswith('--') or line.startswith('PRIMARY KEY') or line.startswith('FOREIGN KEY') or line.startswith('UNIQUE'):
            continue
        col_name = line.split()[0]
        if col_name not in ['id', 'created_at', 'updated_at', 'organization_id', 'created_by', 'is_deleted']:
            columns.append(col_name)
    tables[table_name] = columns

for table, cols in tables.items():
    print(f"Table: {table}")
    print(f"Columns: {', '.join(cols)}\n")
