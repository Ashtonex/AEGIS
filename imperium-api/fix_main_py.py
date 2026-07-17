import re

with open("main.py", "r", encoding="utf-8") as f:
    content = f.read()

# Find all app.include_router that span multiple lines and end with )
pattern = re.compile(r'    app\.include_router\(\s+([a-z_]+)\.router,\s+prefix="([^"]+)",\s+tags=\[([^\]]+)\],\s+dependencies=\[Depends\(require_resource_permission\("([^"]+)"\)\)\],\s+\)', re.MULTILINE)

def replacer(match):
    module = match.group(1)
    prefix = match.group(2)
    tags = match.group(3)
    resource = match.group(4)
    return f'    app.include_router({module}.router, prefix="{prefix}", tags=[{tags}], dependencies=[Depends(require_resource_permission("{resource}"))])  # fmt: skip'

new_content = pattern.sub(replacer, content)

with open("main.py", "w", encoding="utf-8") as f:
    f.write(new_content)
    
print("Fixed main.py")
