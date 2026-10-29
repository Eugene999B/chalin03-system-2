import { useEffect, useRef, useState } from "react";

import {
  clearFinanceCustomerPhoto,
  compressFinanceCustomerPhoto,
  readFinanceCustomerPhoto,
  saveFinanceCustomerPhoto,
} from "../utils/equipmentFinanceCustomerPhoto";

function fileSize(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 KB";
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("en-GH")} KB`;
}

export default function EquipmentFinanceCustomerPhotoPanel() {
  const inputRef = useRef(null);
  const [photo, setPhoto] = useState(() => readFinanceCustomerPhoto());
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const onChange = (event) => setPhoto(event.detail?.photo || null);
    window.addEventListener("chalin03:finance-customer-photo-change", onChange);
    return () => window.removeEventListener("chalin03:finance-customer-photo-change", onChange);
  }, []);

  async function choosePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setWorking(true);
    setProblem("");
    setNotice("");
    try {
      const compressed = await compressFinanceCustomerPhoto(file);
      saveFinanceCustomerPhoto(compressed);
      setPhoto(compressed);
      setNotice(
        `Customer picture compressed from ${fileSize(compressed.original_file_size_bytes)} to ${fileSize(compressed.file_size_bytes)}.`
      );
    } catch (error) {
      setProblem(error.message || "Could not prepare the customer picture.");
    } finally {
      setWorking(false);
    }
  }

  function removePhoto() {
    clearFinanceCustomerPhoto();
    setPhoto(null);
    setProblem("");
    setNotice("Customer picture removed from this installment draft.");
  }

  return (
    <section className="finance-customer-photo" aria-labelledby="finance-customer-photo-title">
      <div className="finance-customer-photo__copy">
        <p>Customer registration</p>
        <h2 id="finance-customer-photo-title">Customer Photo <em>(Optional)</em></h2>
        <span>
          You may add a clear customer picture while creating the installment. It is optional and never blocks customer or installment creation.
        </span>
        <div className="finance-customer-photo__rules">
          <small>Any normal image</small>
          <small>Automatically compressed</small>
          <small>No photo required</small>
        </div>
      </div>

      <div className="finance-customer-photo__workspace">
        <div className={`finance-customer-photo__preview ${photo ? "has-photo" : ""}`}>
          {photo?.data_url ? (
            <img src={photo.data_url} alt="Customer photo preview" />
          ) : (
            <div>
              <b aria-hidden="true">👤</b>
              <strong>No photo added</strong>
              <span>This is optional. Continue without a photo when one is unavailable.</span>
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          className="finance-customer-photo__input"
          type="file"
          accept="image/*"
          capture="user"
          onChange={choosePhoto}
        />

        <div className="finance-customer-photo__actions">
          <button
            type="button"
            className="is-primary"
            onClick={() => inputRef.current?.click()}
            disabled={working}
          >
            {working ? "Preparing…" : photo ? "Change photo" : "Add optional photo"}
          </button>
          {photo ? (
            <button type="button" onClick={removePhoto} disabled={working}>
              Remove
            </button>
          ) : null}
        </div>

        {photo ? (
          <div className="finance-customer-photo__details" role="status">
            <strong>Photo ready</strong>
            <span>{photo.width} × {photo.height}px · {fileSize(photo.file_size_bytes)} · optional field</span>
          </div>
        ) : null}
        {notice ? <div className="finance-customer-photo__message is-success">{notice}</div> : null}
        {problem ? <div className="finance-customer-photo__message is-error" role="alert">{problem}</div> : null}
      </div>
    </section>
  );
}
