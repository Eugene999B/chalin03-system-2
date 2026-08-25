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
    return () =>
      window.removeEventListener("chalin03:finance-customer-photo-change", onChange);
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
        `Customer picture compressed from ${fileSize(compressed.original_file_size_bytes)} to ${fileSize(compressed.file_size_bytes)} without cropping.`
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
        <p>Customer identity evidence</p>
        <h2 id="finance-customer-photo-title">Passport Picture</h2>
        <span>
          Add a clear front-facing customer picture. The browser compresses it securely,
          normalizes the portrait for agreement documents and sends it only when this installment
          application is created. It is then encrypted inside the Finance document vault.
        </span>
        <div className="finance-customer-photo__rules">
          <small>JPEG, PNG or WebP</small>
          <small>Passport portrait crop 35:45</small>
          <small>Compressed before upload</small>
          <small>Used in customer document packs</small>
        </div>
      </div>

      <div className="finance-customer-photo__workspace">
        <div className={`finance-customer-photo__preview ${photo ? "has-photo" : ""}`}>
          {photo?.data_url ? (
            <img src={photo.data_url} alt="Customer passport preview" />
          ) : (
            <div>
              <b aria-hidden="true">👤</b>
              <strong>No customer picture selected</strong>
              <span>The complete face and shoulders should be visible.</span>
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          className="finance-customer-photo__input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
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
            {working ? "Compressing picture…" : photo ? "Replace picture" : "Choose customer picture"}
          </button>
          {photo ? (
            <button type="button" onClick={removePhoto} disabled={working}>
              Remove
            </button>
          ) : null}
        </div>

        {photo ? (
          <div className="finance-customer-photo__details" role="status">
            <strong>Ready for secure upload</strong>
            <span>
              {photo.width} × {photo.height}px · {fileSize(photo.file_size_bytes)} · Passport portrait normalized
            </span>
          </div>
        ) : null}
        {notice ? <div className="finance-customer-photo__message is-success">{notice}</div> : null}
        {problem ? <div className="finance-customer-photo__message is-error" role="alert">{problem}</div> : null}
      </div>
    </section>
  );
}
