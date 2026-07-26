from pathlib import Path

path = Path('README.md')
source = path.read_text(encoding='utf-8')

replacements = {
    '| Current production hardening commit | `96ab439931e2331a5a537207881c4467a64856af` |':
        '| Current production release | `7a33551e348757194acdb4a18fc1be71adb35454` |',
    'The audited release was promoted through PR #76 after PR #75 completed the post-Phase-1 audit and PR #77 added the fail-closed Railway migration runner. PR #83 later promoted the independently reviewed Owner-login and Daily Closing evidence hardening to production at `96ab439931e2331a5a537207881c4467a64856af`.':
        'The audited release was promoted through PR #76 after PR #75 completed the post-Phase-1 audit and PR #77 added the fail-closed Railway migration runner. Later controlled releases added Owner-login and Daily Closing evidence hardening, the Audit Unlock read-only fix, safe Mining/Hire context removal, the one-time Mining trial-data cleanup, automatic workspace notification refresh and measured route-level frontend loading. The current final production release is `7a33551e348757194acdb4a18fc1be71adb35454`.',
}

for old, new in replacements.items():
    if source.count(old) != 1:
        raise RuntimeError(f'Expected exactly one README match: {old[:100]}')
    source = source.replace(old, new)

anchor = 'Commit hashes are release evidence, not permanent pointers. Reconfirm the current `main`, `production`, Railway and Cloudflare state before every later release.\n'
section = '''\n### Final Mining and Equipment completion — 26 July 2026\n\n- Mining trial data was removed by the one-time production cleanup commit `1165c031f62850f1de86b44ae3848217c9b99632`. The transaction dynamically discovered Mining tables, preserved foreign-key enforcement and verified that protected Spare Parts, Equipment Hire, user, business-location and shared-fleet row counts did not change.\n- The temporary cleanup runner was removed immediately after successful Railway verification; normal backend startup was restored at `fc63459d2068b79010a9588fb9dc37af2630fb5f`. The durable database marker `20260726_mining_trial_data_cleanup` prevents repeat execution.\n- PR #95 and production PR #96 added automatic configured Mining/Hire notification refresh, permanent workflow and controlled-correction contracts, updated in-app guides and route-level loading for heavy workspace pages.\n- Clean production builds reduced the initial JavaScript entry from **1,779,882 bytes** to **1,124,530 bytes** — **655,352 bytes or 36.8% smaller**.\n- GitHub issues #55, #66 and #85 were closed with final production evidence.\n- WhatsApp receipt delivery remains disabled until approved Meta configuration exists.\n\nPermanent evidence:\n\n- `docs/MINING_TRIAL_DATA_CLEANUP_RELEASE.md`\n- `docs/MINING_HIRE_FINAL_ACCEPTANCE.md`\n- `docs/FRONTEND_ROUTE_SPLITTING_EVIDENCE.md`\n\n'''

if source.count(anchor) != 1:
    raise RuntimeError('README release-evidence anchor is missing or duplicated.')
source = source.replace(anchor, section + anchor)

sources_anchor = '| Equipment Sales routing | `docs/EQUIPMENT_SALES_ROUTING_ARCHITECTURE.md` |\n'
sources_addition = '''| Mining trial cleanup evidence | `docs/MINING_TRIAL_DATA_CLEANUP_RELEASE.md` |\n| Mining and Equipment final acceptance | `docs/MINING_HIRE_FINAL_ACCEPTANCE.md` |\n| Route-splitting measurements | `docs/FRONTEND_ROUTE_SPLITTING_EVIDENCE.md` |\n'''
if source.count(sources_anchor) != 1:
    raise RuntimeError('README sources-of-truth anchor is missing or duplicated.')
source = source.replace(sources_anchor, sources_anchor + sources_addition)

path.write_text(source, encoding='utf-8')
print('README synchronized with final production release.')
