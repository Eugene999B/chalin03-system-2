from pathlib import Path
import json
import re

ROOT = Path('.')

FILES = {
    'mining_routes': ROOT / 'backend/routes/miningRoutes.js',
    'mining_control_routes': ROOT / 'backend/routes/miningControlRoutes.js',
    'hire_routes': ROOT / 'backend/routes/equipmentHireRoutes.js',
    'hire_commercial_routes': ROOT / 'backend/routes/hireCommercialRoutes.js',
    'equipment_sales_routes': ROOT / 'backend/routes/equipmentSalesRoutes.js',
    'equipment_sales_finalization_routes': ROOT / 'backend/routes/equipmentSalesFinalizationRoutes.js',
    'app': ROOT / 'frontend/src/App.jsx',
    'notification_service': ROOT / 'backend/services/notificationService.js',
    'server': ROOT / 'backend/server.js',
    'schema': ROOT / 'database/schema.sql',
}


def text(path):
    return path.read_text(encoding='utf-8') if path.exists() else ''


def routes(source):
    pattern = re.compile(r"router\.(get|post|put|patch|delete)\(\s*['\"]([^'\"]+)", re.I)
    return [{'method': method.upper(), 'path': route} for method, route in pattern.findall(source)]


def terms(source, needles):
    lower = source.lower()
    return {needle: lower.count(needle.lower()) for needle in needles}


def imports(source):
    return re.findall(r"^import\s+.+?\s+from\s+['\"](.+?)['\"];?$", source, re.M)


def mining_tables(schema):
    return sorted(set(re.findall(r'CREATE TABLE(?: IF NOT EXISTS)?\s+`?(mining_[a-zA-Z0-9_]+)`?', schema, re.I)))


def shared_workspace_tables(schema):
    blocks = re.split(r'(?=CREATE TABLE(?: IF NOT EXISTS)?)', schema, flags=re.I)
    result = []
    for block in blocks:
        name_match = re.search(r'CREATE TABLE(?: IF NOT EXISTS)?\s+`?([a-zA-Z0-9_]+)`?', block, re.I)
        if not name_match:
            continue
        if re.search(r'\bworkspace_code\b', block, re.I) or re.search(r'\bmining_site_id\b', block, re.I):
            result.append(name_match.group(1))
    return sorted(set(result))


report = {'files': {}, 'frontend': {}, 'database': {}, 'findings': []}
route_files = [
    'mining_routes', 'mining_control_routes', 'hire_routes', 'hire_commercial_routes',
    'equipment_sales_routes', 'equipment_sales_finalization_routes'
]
needles = [
    'cancel', 'void', 'reverse', 'correct', 'adjust', 'amend', 'approve', 'reject',
    'reminder', 'overdue', 'notification', 'sms', 'whatsapp', 'delete', 'archive'
]

for key in route_files:
    source = text(FILES[key])
    report['files'][key] = {
        'path': str(FILES[key]),
        'routes': routes(source),
        'term_counts': terms(source, needles),
        'todo_count': len(re.findall(r'\b(?:TODO|FIXME|TBD)\b', source, re.I)),
        'line_count': source.count('\n') + 1 if source else 0,
    }

app_source = text(FILES['app'])
report['frontend'] = {
    'static_import_count': len(imports(app_source)),
    'lazy_count': app_source.count('React.lazy') + app_source.count('lazy('),
    'suspense_count': app_source.count('Suspense'),
    'mining_page_static': 'import MiningOperationsPage ' in app_source,
    'mining_control_static': 'import MiningControlCentrePage ' in app_source,
    'hire_page_static': 'import EquipmentHireOperationsPage ' in app_source,
    'hire_commercial_static': 'import HireCommercialControlPage ' in app_source,
}

schema_source = text(FILES['schema'])
report['database'] = {
    'mining_tables': mining_tables(schema_source),
    'shared_workspace_tables': shared_workspace_tables(schema_source),
}

notification_source = text(FILES['notification_service'])
report['notifications'] = {
    'mining_mentions': notification_source.lower().count('mining'),
    'hire_mentions': notification_source.lower().count('hire'),
    'overdue_mentions': notification_source.lower().count('overdue'),
    'fuel_mentions': notification_source.lower().count('fuel'),
    'stockpile_mentions': notification_source.lower().count('stockpile'),
    'return_mentions': notification_source.lower().count('return'),
}

if report['frontend']['lazy_count'] == 0:
    report['findings'].append('No route-level lazy loading is present in App.jsx.')

for key in route_files:
    counts = report['files'][key]['term_counts']
    if counts['cancel'] + counts['void'] + counts['reverse'] + counts['adjust'] + counts['amend'] == 0:
        report['findings'].append(f'{key} has no obvious controlled correction terminology.')

out = ROOT / 'docs/WORKSPACE_FINAL_AUDIT.json'
out.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
print(f'Wrote {out}')
