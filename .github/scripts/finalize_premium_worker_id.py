from pathlib import Path


def replace_once(source, old, new, label):
    if new in source:
        return source
    if old not in source:
        raise RuntimeError(f"Could not locate {label}.")
    return source.replace(old, new, 1)


page_path = Path("frontend/src/pages/ExpandedWorkerProfilePage.jsx")
page = page_path.read_text(encoding="utf-8")

create_notice = '''            <Notice type="info">
              Employee number, card serial, issue date and expiry date are generated automatically from Business & ID Settings.
            </Notice>
'''
create_number_field = '''            <Notice type="info">
              Employee number, card serial, issue date and expiry date are generated automatically from Business & ID Settings.
            </Notice>

            <Field label="Employee number">
              <input
                type="text"
                value="Generated automatically after saving"
                readOnly
                disabled
              />
            </Field>
'''
page = replace_once(
    page,
    create_notice,
    create_number_field,
    "employee-number explanation in the new-worker form",
)
page_path.write_text(page, encoding="utf-8")


verification_path = Path("backend/routes/workerCardVerificationRoutes.js")
verification = verification_path.read_text(encoding="utf-8")
verification = replace_once(
    verification,
    '''  const verifiedAt = new Date().toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  });
''',
    '''  const verifiedAt = new Date().toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Accra",
  });
  const showDetails =
    state.code !== "invalid" && Boolean(profile.id);
''',
    "safe verification detail flag",
)

old_details = '''      <dl>
        <div>
          <dt>Employee name</dt>
          <dd>${html(profile.full_name || "Not available")}</dd>
        </div>
        <div>
          <dt>Employee number</dt>
          <dd>${html(profile.employee_number || "Not available")}</dd>
        </div>
        <div>
          <dt>Role / title</dt>
          <dd>${html(profile.job_title || "Staff member")}</dd>
        </div>
        <div>
          <dt>Department</dt>
          <dd>${html(profile.department || "Group Operations")}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>${html(workspaceLabel(assignment))}</dd>
        </div>
        <div>
          <dt>Card serial</dt>
          <dd>${html(
            profile.id_card_serial ||
              profile.employee_number ||
              "Not available"
          )}</dd>
        </div>
        <div>
          <dt>Issue date</dt>
          <dd>${html(formatDate(profile.id_card_issue_date))}</dd>
        </div>
        <div>
          <dt>Expiry date</dt>
          <dd>${html(formatDate(profile.id_card_expiry_date))}</dd>
        </div>
      </dl>
'''
new_details = '''      ${
        showDetails
          ? `<dl>
        <div>
          <dt>Employee name</dt>
          <dd>${html(profile.full_name || "Not available")}</dd>
        </div>
        <div>
          <dt>Employee number</dt>
          <dd>${html(profile.employee_number || "Not available")}</dd>
        </div>
        <div>
          <dt>Role / title</dt>
          <dd>${html(profile.job_title || "Staff member")}</dd>
        </div>
        <div>
          <dt>Department</dt>
          <dd>${html(profile.department || "Group Operations")}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>${html(workspaceLabel(assignment))}</dd>
        </div>
        <div>
          <dt>Card serial</dt>
          <dd>${html(
            profile.id_card_serial ||
              profile.employee_number ||
              "Not available"
          )}</dd>
        </div>
        <div>
          <dt>Issue date</dt>
          <dd>${html(formatDate(profile.id_card_issue_date))}</dd>
        </div>
        <div>
          <dt>Expiry date</dt>
          <dd>${html(formatDate(profile.id_card_expiry_date))}</dd>
        </div>
      </dl>`
          : `<p class="notice">No worker details are displayed unless the QR signature is valid.</p>`
      }
'''
verification = replace_once(
    verification,
    old_details,
    new_details,
    "invalid-signature privacy guard",
)
verification_path.write_text(verification, encoding="utf-8")


test_path = Path("backend/tests/workerCardPrintLayout.test.js")
tests = test_path.read_text(encoding="utf-8")
tests = replace_once(
    tests,
    '''  assert.match(
    verificationRoute,
    /not a Ghana Card, ECOWAS identity card, passport/i
  );
''',
    '''  assert.match(
    verificationRoute,
    /not a Ghana Card, ECOWAS identity card, passport/i
  );
  assert.match(
    verificationRoute,
    /state\.code !== "invalid"/
  );
  assert.match(
    verificationRoute,
    /No worker details are displayed unless the QR signature is valid/
  );
''',
    "invalid QR privacy assertions",
)
tests = replace_once(
    tests,
    '''  assert.match(page, /Generated employee number:/);
''',
    '''  assert.match(page, /Generated employee number:/);
  assert.match(
    page,
    /Generated automatically after saving/
  );
''',
    "new-worker employee-number field assertion",
)
test_path.write_text(tests, encoding="utf-8")
