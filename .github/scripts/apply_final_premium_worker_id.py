from pathlib import Path


def replace_once(source, old, new, label):
    if new in source:
        return source
    if old not in source:
        raise RuntimeError(f"Could not locate {label}.")
    return source.replace(old, new, 1)


print_routes_path = Path("backend/routes/workerPrintRoutes.js")
print_routes = print_routes_path.read_text(encoding="utf-8")
print_routes = replace_once(
    print_routes,
    'require("../services/workerCardArtworkService")',
    'require("../services/premiumWorkerCardService")',
    "worker card service import",
)
print_routes_path.write_text(print_routes, encoding="utf-8")


server_path = Path("backend/server.js")
server = server_path.read_text(encoding="utf-8")
server = replace_once(
    server,
    'const workerPrintRoutes = require("./routes/workerPrintRoutes");',
    'const workerPrintRoutes = require("./routes/workerPrintRoutes");\nconst workerCardVerificationRoutes = require("./routes/workerCardVerificationRoutes");',
    "worker verification route import",
)
server = replace_once(
    server,
    'app.use("/api/release2-final", workerProfileExpansionRoutes);',
    'app.use("/api/release2-final", workerCardVerificationRoutes);\napp.use("/api/release2-final", workerProfileExpansionRoutes);',
    "public worker verification route registration",
)
server_path.write_text(server, encoding="utf-8")


drawing_path = Path("backend/services/workerCardDrawingService.js")
drawing = drawing_path.read_text(encoding="utf-8")
old_footer = '''  doc
    .moveTo(18, 145)
    .lineTo(96, 145)
    .strokeColor(NAVY)
    .lineWidth(0.55)
    .stroke();
  doc
    .moveTo(146, 145)
    .lineTo(224, 145)
    .strokeColor(NAVY)
    .lineWidth(0.55)
    .stroke();

  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(3.2)
    .text("EMPLOYEE SIGNATURE", 18, 147, {
      width: 78,
      align: "center",
    });
  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(3.2)
    .text("AUTHORIZED SIGNATURE", 146, 147, {
      width: 78,
      align: "center",
    });

  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(3.1)
    .text(
      "CORPORATE CREDENTIAL — NOT A NATIONAL OR TRAVEL IDENTITY DOCUMENT",
      44,
      150,
      {
        width: 154,
        align: "center",
        lineBreak: false,
      }
    );

  doc.rect(0, 152, CARD_WIDTH, 1).fill(GOLD);'''
new_footer = '''  doc
    .moveTo(18, 140)
    .lineTo(96, 140)
    .strokeColor(NAVY)
    .lineWidth(0.55)
    .stroke();
  doc
    .moveTo(146, 140)
    .lineTo(224, 140)
    .strokeColor(NAVY)
    .lineWidth(0.55)
    .stroke();

  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(2.8)
    .text("EMPLOYEE SIGNATURE", 18, 141.5, {
      width: 78,
      align: "center",
      lineBreak: false,
    });
  doc
    .fillColor(MUTED)
    .font("Helvetica-Bold")
    .fontSize(2.8)
    .text("AUTHORIZED SIGNATURE", 146, 141.5, {
      width: 78,
      align: "center",
      lineBreak: false,
    });

  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(2.7)
    .text(
      "CORPORATE CREDENTIAL — NOT A NATIONAL OR TRAVEL IDENTITY DOCUMENT",
      39,
      147,
      {
        width: 164,
        align: "center",
        lineBreak: false,
      }
    );

  doc.rect(0, 151.5, CARD_WIDTH, 1.5).fill(GOLD);'''
drawing = replace_once(
    drawing,
    old_footer,
    new_footer,
    "safe CR80 back-card footer",
)
drawing_path.write_text(drawing, encoding="utf-8")


page_path = Path("frontend/src/pages/ExpandedWorkerProfilePage.jsx")
page = page_path.read_text(encoding="utf-8")

old_create_message = '''      setCreateForm(emptyCreateForm);
      setCreateOpen(false);
      setMessage(response.data.message);
'''
new_create_message = '''      const generatedEmployeeNumber =
        response.data.worker.profile.employee_number;

      setCreateForm(emptyCreateForm);
      setCreateOpen(false);
      setMessage(
        `${response.data.message} Generated employee number: ${generatedEmployeeNumber}.`
      );
'''
page = replace_once(
    page,
    old_create_message,
    new_create_message,
    "generated employee number creation message",
)

old_profile_fields = '''                    {profileFields.map(
'''
new_profile_fields = '''                    <Field label="Employee number (system generated)">
                      <input
                        type="text"
                        value={
                          selectedProfile.employee_number || ""
                        }
                        readOnly
                        disabled
                      />
                    </Field>

                    {profileFields.map(
'''
page = replace_once(
    page,
    old_profile_fields,
    new_profile_fields,
    "read-only employee number form field",
)

page_path.write_text(page, encoding="utf-8")
