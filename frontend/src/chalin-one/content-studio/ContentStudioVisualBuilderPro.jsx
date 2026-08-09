import { useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { contentStudioErrorMessage } from "./contentStudioApi";
import { createPage } from "./contentStudioPageApi";
import ContentStudioReleaseReadiness from "./ContentStudioReleaseReadiness";
import ContentStudioRevisionIntelligence from "./ContentStudioRevisionIntelligence";
import ContentStudioVisualBuilder from "./ContentStudioVisualBuilder";
import { CONTENT_STUDIO_PERMISSIONS } from "./contentStudioModel";
import { visualSectionForSave } from "./contentStudioVisualBuilderModel";
import {
  VISUAL_PAGE_TEMPLATES,
  getVisualPageTemplate,
  visualSectionsFromTemplate,
  visualTemplateSectionLabels,
} from "./contentStudioPageTemplateModel";
import "./contentStudioVisualBuilderPro.css";

const EMPTY_TEMPLATE_PAGE = Object.freeze({
  page_key: "",
  slug: "",
  title: "",
  subtitle: "",
  summary: "",
});

function TemplateSequence({ templateKey, compact = false }) {
  const sections = visualTemplateSectionLabels(templateKey);
  return (
    <div className={`cs-vbt-sequence${compact ? " is-compact" : ""}`} aria-label="Template section sequence">
      {sections.map((section, index) => (
        <div key={`${templateKey}-${section.type}-${index}`}>
          <span>{section.badge}</span>
          <small>{section.label}</small>
        </div>
      ))}
    </div>
  );
}

function TemplateCard({ template, active, onChoose }) {
  return (
    <button
      type="button"
      className={`cs-vbt-card${active ? " is-active" : ""}`}
      onClick={() => onChoose(template.key)}
      aria-pressed={active}
    >
      <div className="cs-vbt-card-top">
        <span>{template.badge}</span>
        <small>{template.homepageOnly ? "Homepage" : template.category}</small>
      </div>
      <strong>{template.label}</strong>
      <p>{template.description}</p>
      <TemplateSequence templateKey={template.key} compact />
      <b>{active ? "Selected" : "Choose template"} ↗</b>
    </button>
  );
}

function TemplateLauncherDialog({ open, canCreate, onClose, onCreated }) {
  const [selectedKey, setSelectedKey] = useState("corporate-profile");
  const [form, setForm] = useState({ ...EMPTY_TEMPLATE_PAGE });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedTemplate = getVisualPageTemplate(selectedKey) || VISUAL_PAGE_TEMPLATES[0];

  if (!open) return null;

  function chooseTemplate(key) {
    setSelectedKey(key);
    setError("");
  }

  async function createFromTemplate(event) {
    event.preventDefault();
    if (!canCreate || saving || !selectedTemplate) return;
    setSaving(true);
    setError("");
    try {
      const sections = visualSectionsFromTemplate(selectedTemplate.key);
      const homepage = selectedTemplate.homepageOnly === true;
      const result = await createPage({
        page_key: form.page_key,
        slug: form.slug,
        page_type: homepage ? "landing" : "standard",
        template_key: homepage ? "feature" : "standard",
        menu_title: form.title,
        title: form.title,
        subtitle: form.subtitle,
        summary: form.summary,
        body: {},
        seo_title: form.title,
        meta_description: form.summary,
        robots_directive: "index,follow",
        is_homepage: homepage,
        show_in_search: true,
        show_in_sitemap: true,
        change_summary: `Created from Visual Builder template: ${selectedTemplate.label}`,
        sections: sections.map(visualSectionForSave),
      });
      setForm({ ...EMPTY_TEMPLATE_PAGE });
      onCreated({ template: selectedTemplate, page: result?.page || null });
    } catch (requestError) {
      setError(contentStudioErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cs-vbt-dialog" role="dialog" aria-modal="true" aria-labelledby="cs-vbt-dialog-title">
      <button type="button" className="cs-vbt-backdrop" aria-label="Close page template library" onClick={onClose} />
      <section className="cs-vbt-panel">
        <header className="cs-vbt-panel-head">
          <div>
            <span>VISUAL BUILDER / PAGE TEMPLATES</span>
            <h2 id="cs-vbt-dialog-title">Start from a professional composition</h2>
            <p>Templates create ordinary governed draft sections. They do not publish, approve, or bypass the existing Content Studio workflow.</p>
          </div>
          <button type="button" onClick={onClose}>Close ×</button>
        </header>

        <div className="cs-vbt-grid">
          {VISUAL_PAGE_TEMPLATES.map((template) => (
            <TemplateCard key={template.key} template={template} active={selectedTemplate?.key === template.key} onChoose={chooseTemplate} />
          ))}
        </div>

        <div className="cs-vbt-selected">
          <div className="cs-vbt-selected-copy">
            <span>{selectedTemplate.homepageOnly ? "HOMEPAGE ORCHESTRATION" : `${selectedTemplate.category.toUpperCase()} TEMPLATE`}</span>
            <h3>{selectedTemplate.label}</h3>
            <p>{selectedTemplate.note}</p>
            {selectedTemplate.homepageOnly ? (
              <div className="cs-vbt-home-rule">
                <strong>No duplicate homepage hero.</strong>
                <span>The cinematic homepage opening is controlled by the homepage page record and public homepage renderer. This template starts below that permanent shell.</span>
              </div>
            ) : null}
            <TemplateSequence templateKey={selectedTemplate.key} />
          </div>

          <form className="cs-vbt-create" onSubmit={createFromTemplate}>
            <div className="cs-vbt-create-head">
              <span>NEW GOVERNED DRAFT</span>
              <strong>{selectedTemplate.homepageOnly ? "Create homepage composition" : `Create ${selectedTemplate.label.toLowerCase()} page`}</strong>
              <small>Nothing becomes public until review and publication complete.</small>
            </div>
            <label>
              <span>Internal page key</span>
              <input required value={form.page_key} onChange={(event) => setForm((current) => ({ ...current, page_key: event.target.value }))} placeholder="company_profile" />
              <small>Use the same governed page-key rules as Pages Manager.</small>
            </label>
            <label>
              <span>Public URL slug</span>
              <input required value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} placeholder="company-profile" />
            </label>
            <label>
              <span>Page title</span>
              <input required value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label>
              <span>Subtitle</span>
              <input value={form.subtitle} onChange={(event) => setForm((current) => ({ ...current, subtitle: event.target.value }))} />
            </label>
            <label>
              <span>Summary / meta-description starting point</span>
              <textarea rows="3" value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} />
            </label>
            {error ? <div className="cs-vbt-error" role="alert">{error}</div> : null}
            {canCreate ? (
              <button className="cs-vbt-create-button" disabled={saving}>{saving ? "Creating governed draft…" : "Create from template →"}</button>
            ) : (
              <div className="cs-vbt-readonly">Your Studio role can inspect templates but cannot create pages.</div>
            )}
          </form>
        </div>
      </section>
    </div>
  );
}

function HomepageOrchestration() {
  const template = getVisualPageTemplate("homepage-orchestration");
  return (
    <section className="cs-vbt-home-orchestration">
      <div className="cs-vbt-home-copy">
        <span>HOMEPAGE / ORCHESTRATION RULE</span>
        <h2>Compose below the permanent opening—not on top of it.</h2>
        <p>The public homepage already owns the cinematic company opening, visitor-intent entry, business worlds, project/equipment signals, leadership, newsroom and location systems. Governed Visual Builder sections should extend that experience with approved narrative, proof and engagement instead of duplicating it.</p>
      </div>
      <div className="cs-vbt-home-map">
        <div className="is-fixed"><span>01</span><strong>Permanent public shell</strong><small>Opening · intents · business worlds · operating signals</small></div>
        <div className="is-builder"><span>02</span><strong>Governed builder layer</strong><small>{template.sections.map((section) => section.heading).join(" · ")}</small></div>
        <div className="is-fixed"><span>03</span><strong>Permanent closing systems</strong><small>Newsroom · locations · final company action</small></div>
      </div>
    </section>
  );
}

export default function ContentStudioVisualBuilderPro() {
  const auth = useAuth();
  const canCreate = auth.hasPermission(CONTENT_STUDIO_PERMISSIONS.create);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [builderKey, setBuilderKey] = useState(0);
  const [notice, setNotice] = useState("");
  const templateCount = useMemo(() => VISUAL_PAGE_TEMPLATES.length, []);

  function handleCreated({ template, page }) {
    setTemplatesOpen(false);
    setBuilderKey((value) => value + 1);
    setNotice(`${template.label} draft created${page?.slug ? ` at /${page.slug}` : ""}. Open it from the Visual Builder page library to edit, preview and send it through review.`);
  }

  function handleRevisionCommitted() {
    setBuilderKey((value) => value + 1);
    setNotice("Revision Intelligence committed the staged structure to its governed draft. Visual Builder has refreshed against the latest draft state.");
  }

  return (
    <div className="cs-vbt-shell">
      <section className="cs-vbt-command">
        <div className="cs-vbt-command-mark">TP</div>
        <div>
          <span>PHASE 2C / TEMPLATE ORCHESTRATION</span>
          <h1>Page Templates</h1>
          <p>{templateCount} governed starting compositions now sit on top of Visual Builder. Start with structure, then edit every block with the existing no-code canvas.</p>
        </div>
        <button type="button" onClick={() => setTemplatesOpen(true)}>Template library <b>↗</b></button>
      </section>

      {notice ? <div className="cs-vbt-notice" role="status"><div><strong>Template workspace updated</strong><span>{notice}</span></div><button type="button" onClick={() => setNotice("")}>Close</button></div> : null}

      <HomepageOrchestration />

      <ContentStudioRevisionIntelligence onCommitted={handleRevisionCommitted} />

      <ContentStudioReleaseReadiness />

      <section className="cs-vbt-template-strip" aria-label="Visual Builder page templates">
        <header><span>QUICK START</span><strong>Choose a composition before opening an empty canvas.</strong></header>
        <div>
          {VISUAL_PAGE_TEMPLATES.map((template) => (
            <button type="button" key={template.key} onClick={() => setTemplatesOpen(true)}>
              <span>{template.badge}</span>
              <small>{template.homepageOnly ? "Homepage" : template.category}</small>
              <strong>{template.label}</strong>
              <TemplateSequence templateKey={template.key} compact />
            </button>
          ))}
        </div>
      </section>

      <ContentStudioVisualBuilder key={builderKey} />

      <TemplateLauncherDialog
        open={templatesOpen}
        canCreate={canCreate}
        onClose={() => setTemplatesOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}