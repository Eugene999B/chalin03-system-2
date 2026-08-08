import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  aiErrorMessage,
  getAiKnowledgeSource,
  getAiStatus,
  ingestAiKnowledgeDocument,
  listAiKnowledge,
  listAiKnowledgeDocumentChunks,
  listAiKnowledgeDocuments,
} from "./aiApi";
import "./documentIntelligence.css";

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = ".txt,.md,.markdown,.csv,.json,.html,.htm,.xml";
const MIME_BY_EXTENSION = Object.freeze({
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
});

function humanize(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fileMime(file) {
  const extension = String(file?.name || "")
    .split(".")
    .pop()
    .toLowerCase();
  return String(file?.type || "").split(";", 1)[0] || MIME_BY_EXTENSION[extension] || "";
}

function permissionSet(status) {
  return new Set(
    Array.isArray(status?.permissions?.permissions)
      ? status.permissions.permissions
      : []
  );
}

function StatusCard({ title, value, note }) {
  return (
    <article className="di-stat-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

export default function DocumentIntelligencePage() {
  const [searchParams] = useSearchParams();
  const requestedSourceKey = searchParams.get("source") || "";
  const requestedDocumentId = Number(searchParams.get("document") || 0);
  const requestedChunkId = Number(searchParams.get("chunk") || 0);
  const [status, setStatus] = useState(null);
  const [sources, setSources] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [details, setDetails] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [chunks, setChunks] = useState([]);
  const [file, setFile] = useState(null);
  const [sourceLocator, setSourceLocator] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const permissions = useMemo(() => permissionSet(status), [status]);
  const canView = permissions.has("ai.knowledge.view");
  const canManage = permissions.has("ai.knowledge.manage");
  const draftVersion = useMemo(
    () =>
      (details?.versions || []).find(
        (version) => version.version_status === "draft"
      ) || null,
    [details]
  );

  const loadSource = useCallback(async (sourceId, signal) => {
    if (!sourceId) {
      setDetails(null);
      setDocuments([]);
      return;
    }
    setDetailLoading(true);
    setError("");
    setSelectedDocument(null);
    setChunks([]);
    try {
      const [nextDetails, nextDocuments] = await Promise.all([
        getAiKnowledgeSource(sourceId, { signal }),
        listAiKnowledgeDocuments(sourceId, { signal }),
      ]);
      setDetails(nextDetails);
      setDocuments(nextDocuments);
    } catch (requestError) {
      if (!signal?.aborted) setError(aiErrorMessage(requestError));
    } finally {
      if (!signal?.aborted) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      getAiStatus({ signal: controller.signal }),
      listAiKnowledge({}, { signal: controller.signal }),
    ])
      .then(([nextStatus, nextSources]) => {
        setStatus(nextStatus);
        setSources(nextSources);
        const requestedSource = nextSources.find(
          (source) => source.source_key === requestedSourceKey
        );
        const initialSource = requestedSource || nextSources[0];
        if (initialSource?.id) setSelectedId(String(initialSource.id));
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(aiErrorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestedSourceKey]);

  useEffect(() => {
    const controller = new AbortController();
    if (selectedId) loadSource(selectedId, controller.signal);
    return () => controller.abort();
  }, [loadSource, selectedId]);

  useEffect(() => {
    if (
      !requestedDocumentId ||
      !details?.source ||
      details.source.source_key !== requestedSourceKey ||
      Number(selectedDocument?.id || 0) === requestedDocumentId
    ) {
      return;
    }
    const targetDocument = documents.find(
      (document) => Number(document.id) === requestedDocumentId
    );
    if (targetDocument) inspectDocument(targetDocument);
  }, [
    details?.source,
    documents,
    requestedDocumentId,
    requestedSourceKey,
    selectedDocument?.id,
  ]);

  useEffect(() => {
    if (!requestedChunkId || chunkLoading || chunks.length === 0) return;
    const target = window.document.getElementById(
      `knowledge-chunk-${requestedChunkId}`
    );
    if (!target) return;
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
    });
  }, [chunkLoading, chunks, requestedChunkId]);

  async function ingest(event) {
    event.preventDefault();
    if (!canManage || !draftVersion || !file || ingesting) return;
    setError("");
    setNotice("");

    if (file.size > MAX_BYTES) {
      setError("This file is larger than the 2 MB governed ingestion limit.");
      return;
    }
    const mimeType = fileMime(file);
    if (!Object.values(MIME_BY_EXTENSION).includes(mimeType)) {
      setError(
        "This parser is not enabled. Use TXT, Markdown, CSV, JSON, HTML or XML. PDF, DOCX and OCR remain separately disabled."
      );
      return;
    }

    setIngesting(true);
    try {
      const text = await file.text();
      const result = await ingestAiKnowledgeDocument(
        details.source.id,
        draftVersion.id,
        {
          file_name: file.name,
          mime_type: mimeType,
          source_locator: sourceLocator.trim() || null,
          content_text: text,
        }
      );
      setNotice(
        `${result.file_name} parsed into ${result.chunk_count} governed chunk${
          result.chunk_count === 1 ? "" : "s"
        }. Raw binary storage: disabled.`
      );
      setFile(null);
      setSourceLocator("");
      event.currentTarget.reset();
      setDocuments(
        await listAiKnowledgeDocuments(details.source.id, {
          versionId: draftVersion.id,
        })
      );
    } catch (requestError) {
      setError(aiErrorMessage(requestError));
    } finally {
      setIngesting(false);
    }
  }

  async function inspectDocument(document) {
    setSelectedDocument(document);
    setChunkLoading(true);
    setError("");
    try {
      setChunks(
        await listAiKnowledgeDocumentChunks(
          details.source.source_key || details.source.id,
          document.id
        )
      );
    } catch (requestError) {
      setError(aiErrorMessage(requestError));
      setChunks([]);
    } finally {
      setChunkLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="di-shell di-center" role="status">
        <strong>Opening Document Intelligence…</strong>
        <span>Loading governed knowledge permissions and sources.</span>
      </main>
    );
  }

  if (error && !status) {
    return (
      <main className="di-shell di-center">
        <strong>Document Intelligence unavailable</strong>
        <span>{error}</span>
        <Link to="/intelligence">Return to Intelligence</Link>
      </main>
    );
  }

  if (!canView) {
    return (
      <main className="di-shell di-center">
        <strong>Knowledge permission required</strong>
        <span>This account does not have ai.knowledge.view.</span>
        <Link to="/intelligence">Return to Intelligence</Link>
      </main>
    );
  }

  const parsedCount = documents.filter((item) => item.parse_status === "parsed").length;
  const chunkCount = documents.reduce(
    (sum, item) => sum + Number(item.chunk_count || 0),
    0
  );

  return (
    <main className="di-shell">
      <header className="di-topbar">
        <div>
          <span className="di-eyebrow">CHALIN ONE · Governed Knowledge</span>
          <h1>Document Intelligence</h1>
          <p>
            Parse approved text documents into exact-version chunks before independent review. Retrieval remains read-only and provider-independent.
          </p>
        </div>
        <div className="di-actions">
          <Link to="/intelligence">Intelligence</Link>
          <Link to="/">Staff system</Link>
        </div>
      </header>

      <section className="di-safety-banner" role="status">
        <strong>No raw binary storage.</strong>
        <span>
          TXT, Markdown, CSV, JSON, HTML and XML are enabled. PDF, DOCX, images and OCR remain disabled until separate parser adapters are reviewed.
        </span>
      </section>

      <section className="di-stats" aria-label="Document intelligence summary">
        <StatusCard title="Governed sources" value={sources.length} note="Visible to this account" />
        <StatusCard title="Parsed documents" value={parsedCount} note="Selected source" />
        <StatusCard title="Retrieval chunks" value={chunkCount} note="Local hash vector v1" />
        <StatusCard
          title="Editable draft"
          value={draftVersion ? `v${draftVersion.version_number}` : "None"}
          note="Ingestion is draft-only"
        />
      </section>

      {error ? <div className="di-banner di-banner-error" role="alert">{error}</div> : null}
      {notice ? <div className="di-banner di-banner-success" role="status">{notice}</div> : null}

      <section className="di-grid">
        <article className="di-panel">
          <div className="di-panel-head">
            <div>
              <span className="di-eyebrow">1 · Select source</span>
              <h2>Governed knowledge source</h2>
            </div>
          </div>
          <label className="di-field">
            Source
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              <option value="">Choose a source</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title} · {humanize(source.visibility)}
                </option>
              ))}
            </select>
          </label>

          {detailLoading ? (
            <div className="di-empty">Loading source versions…</div>
          ) : details?.source ? (
            <div className="di-source-card">
              <strong>{details.source.title}</strong>
              <span>{details.source.source_key}</span>
              <p>{details.source.description || "No source description supplied."}</p>
              <div className="di-tags">
                <span>{humanize(details.source.source_type)}</span>
                <span>{humanize(details.source.visibility)}</span>
                <span>{humanize(details.source.source_status)}</span>
              </div>
              <div className="di-version-list">
                {(details.versions || []).map((version) => (
                  <div key={version.id} className="di-version-row">
                    <strong>Version {version.version_number}</strong>
                    <span>{humanize(version.version_status)}</span>
                    <small>{String(version.checksum_sha256 || "").slice(0, 14)}…</small>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="di-empty">Choose a governed source.</div>
          )}
        </article>

        <article className="di-panel">
          <div className="di-panel-head">
            <div>
              <span className="di-eyebrow">2 · Ingest</span>
              <h2>Attach a text document</h2>
            </div>
          </div>
          {!canManage ? (
            <div className="di-empty">
              This account has view permission only. ai.knowledge.manage is required to ingest documents.
            </div>
          ) : !draftVersion ? (
            <div className="di-empty">
              Create or open an editable draft version before ingesting a document. In-review and published versions cannot be changed.
            </div>
          ) : (
            <form className="di-form" onSubmit={ingest}>
              <label className="di-upload-zone">
                <input
                  type="file"
                  accept={ACCEPT}
                  required
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
                <strong>{file ? file.name : "Choose governed text document"}</strong>
                <span>
                  {file
                    ? `${formatBytes(file.size)} · ${fileMime(file) || "unknown type"}`
                    : "TXT · Markdown · CSV · JSON · HTML · XML · maximum 2 MB"}
                </span>
              </label>
              <label className="di-field">
                Source locator or register reference
                <input
                  value={sourceLocator}
                  maxLength={700}
                  placeholder="e.g. Policy Register / HR / Safety Manual / Section 4"
                  onChange={(event) => setSourceLocator(event.target.value)}
                />
              </label>
              <button type="submit" disabled={!file || ingesting}>
                {ingesting ? "Parsing and chunking…" : `Ingest into draft v${draftVersion.version_number}`}
              </button>
              <small className="di-helper">
                The exact parsed document becomes part of this draft version's review evidence. It cannot be added after the version enters review.
              </small>
            </form>
          )}
        </article>
      </section>

      <section className="di-panel di-documents-panel">
        <div className="di-panel-head">
          <div>
            <span className="di-eyebrow">3 · Review exact parsing</span>
            <h2>Ingested documents and chunks</h2>
          </div>
          <span>{documents.length} document{documents.length === 1 ? "" : "s"}</span>
        </div>

        {documents.length === 0 ? (
          <div className="di-empty">No ingested documents exist for this source yet.</div>
        ) : (
          <div className="di-document-grid">
            <div className="di-document-list">
              {documents.map((document) => (
                <button
                  type="button"
                  key={document.id}
                  className={selectedDocument?.id === document.id ? "is-active" : ""}
                  onClick={() => inspectDocument(document)}
                >
                  <strong>{document.file_name}</strong>
                  <span>
                    v{document.version_number} · {humanize(document.parse_status)} · {document.chunk_count} chunks
                  </span>
                  <small>
                    {formatBytes(document.content_bytes)} · {document.extracted_line_count} lines · {String(document.content_sha256 || "").slice(0, 12)}…
                  </small>
                  <small>{formatDate(document.parsed_at || document.created_at)}</small>
                </button>
              ))}
            </div>

            <div className="di-chunk-review">
              {!selectedDocument ? (
                <div className="di-empty">Choose a document to inspect its exact retrieval chunks.</div>
              ) : chunkLoading ? (
                <div className="di-empty">Loading exact chunks…</div>
              ) : chunks.length === 0 ? (
                <div className="di-empty">No chunks were returned for this document.</div>
              ) : (
                chunks.map((chunk) => (
                  <article
                    className={`di-chunk-card${
                      Number(chunk.id) === requestedChunkId ? " is-citation-target" : ""
                    }`}
                    id={`knowledge-chunk-${chunk.id}`}
                    key={chunk.id}
                    tabIndex={-1}
                  >
                    <div className="di-chunk-head">
                      <strong>Chunk {chunk.chunk_index + 1}</strong>
                      <span>
                        lines {chunk.line_start || "?"}–{chunk.line_end || "?"}
                      </span>
                    </div>
                    {chunk.heading_path ? <small>{chunk.heading_path}</small> : null}
                    <pre>{chunk.chunk_text}</pre>
                    <div className="di-tags">
                      <span>{chunk.vector_model_key}</span>
                      <span>≈ {chunk.token_estimate} tokens</span>
                      <span>{String(chunk.chunk_sha256 || "").slice(0, 12)}…</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}