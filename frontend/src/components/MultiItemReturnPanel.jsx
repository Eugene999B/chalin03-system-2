import {
  useEffect,
  useMemo,
  useState,
} from "react";

import axiosClient from "../api/axiosClient";

function formatMoney(value) {
  return `GHS ${Number(value || 0).toFixed(2)}`;
}

function makeLine(item) {
  return {
    product_id: Number(item.product_id),
    product_name: item.product_name,
    remaining_quantity: Number(
      item.remaining_quantity || 0
    ),
    pending_return_quantity: Number(item.pending_return_quantity || 0),
    active_refund_request_count: Number(item.active_refund_request_count || 0),
    active_refund_request_codes: Array.isArray(item.active_refund_request_codes)
      ? item.active_refund_request_codes
      : [],
    unit_price: Number(item.unit_price || 0),
    selected: false,
    quantity: "",
    refund_amount: "0",
  };
}

function initialRefundDetails() {
  return {
    refund_method: "none",
    refund_reference: "",
  };
}

export default function MultiItemReturnPanel({
  saleId,
  saleItems,
  storeCode,
  storeName,
  onResult,
}) {
  const [lines, setLines] = useState([]);
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] =
    useState("stock_only");

  const [refundDetails, setRefundDetails] =
    useState(initialRefundDetails);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    setLines((saleItems || []).map(makeLine));
    setReason("");
    setOutcome("stock_only");
    setRefundDetails(initialRefundDetails());
    setError("");
  }, [saleId, saleItems]);

  const selectedLines = useMemo(
    () =>
      lines.filter(
        (line) => line.selected
      ),
    [lines]
  );

  const estimatedTotal =
    selectedLines.reduce(
      (total, line) =>
        total +
        line.unit_price *
          Number(line.quantity || 0),
      0
    );

  const refundTotal =
    selectedLines.reduce(
      (total, line) =>
        total +
        Number(
          line.refund_amount || 0
        ),
      0
    );

  function selectLine(productId, selected) {
    setLines((current) =>
      current.map((line) => {
        if (
          line.product_id !==
          Number(productId)
        ) {
          return line;
        }

        const quantity =
          selected && !line.quantity
            ? "1"
            : line.quantity;

        return {
          ...line,
          selected,
          quantity,
          refund_amount:
            selected &&
            outcome === "refund"
              ? (
                  line.unit_price *
                  Number(quantity || 0)
                ).toFixed(2)
              : line.refund_amount,
        };
      })
    );
  }

  function changeQuantity(
    productId,
    value
  ) {
    setLines((current) =>
      current.map((line) => {
        if (
          line.product_id !==
          Number(productId)
        ) {
          return line;
        }

        return {
          ...line,
          quantity: value,
          refund_amount:
            outcome === "refund"
              ? (
                  line.unit_price *
                  Number(value || 0)
                ).toFixed(2)
              : line.refund_amount,
        };
      })
    );
  }

  function changeRefund(
    productId,
    value
  ) {
    setLines((current) =>
      current.map((line) =>
        line.product_id ===
        Number(productId)
          ? {
              ...line,
              refund_amount: value,
            }
          : line
      )
    );
  }

  function changeOutcome(value) {
    setOutcome(value);

    setLines((current) =>
      current.map((line) => ({
        ...line,
        refund_amount:
          value === "refund" &&
          line.selected
            ? (
                line.unit_price *
                Number(
                  line.quantity || 0
                )
              ).toFixed(2)
            : "0",
      }))
    );

    if (value === "stock_only") {
      setRefundDetails(initialRefundDetails());
    }
  }

  function changeRefundDetails(event) {
    setRefundDetails((current) => ({
      ...current,
      [event.target.name]:
        event.target.value,
    }));
  }

  function validate() {
    if (!saleId) {
      return "Select the customer's receipt first.";
    }

    if (!selectedLines.length) {
      return "Select at least one returned product.";
    }

    if (!reason.trim()) {
      return "Enter the reason for this customer return.";
    }

    for (const line of selectedLines) {
      const quantity = Number(
        line.quantity || 0
      );

      if (
        !Number.isInteger(quantity) ||
        quantity <= 0
      ) {
        return `${line.product_name}: enter a positive whole-number quantity.`;
      }

      if (
        quantity >
        line.remaining_quantity
      ) {
        return `${line.product_name}: only ${line.remaining_quantity} remain available for return.`;
      }

      if (outcome === "refund") {
        const refundAmount = Number(
          line.refund_amount || 0
        );

        const maximum =
          line.unit_price * quantity;

        if (
          !Number.isFinite(
            refundAmount
          ) ||
          refundAmount <= 0
        ) {
          return `${line.product_name}: enter the amount refunded.`;
        }

        if (
          refundAmount - maximum >
          0.009
        ) {
          return `${line.product_name}: refund cannot exceed ${formatMoney(maximum)}.`;
        }
      }
    }

    if (outcome === "refund") {
      if (
        ![
          "cash",
          "momo",
          "bank",
          "other",
        ].includes(
          refundDetails.refund_method
        )
      ) {
        return "Choose the refund channel.";
      }

      if (
        [
          "momo",
          "bank",
          "other",
        ].includes(
          refundDetails.refund_method
        ) &&
        !refundDetails.refund_reference.trim()
      ) {
        return "Enter the refund transaction/reference number.";
      }
    }

    return "";
  }

  async function submitReturns(event) {
    event.preventDefault();
    setError("");

    const validationError = validate();

    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);

    let completed = 0;

    try {
      for (const line of selectedLines) {
        const payload = {
          sale_id: Number(saleId),
          product_id: line.product_id,
          quantity: Number(line.quantity),
          reason: reason.trim(),
          return_type: outcome,
          refund_amount:
            outcome === "refund"
              ? Number(line.refund_amount || 0)
              : 0,
          refund_method:
            outcome === "refund"
              ? refundDetails.refund_method
              : "none",
          refund_reference:
            outcome === "refund"
              ? refundDetails.refund_reference
              : "",
        };

        if (outcome === "refund") {
          await axiosClient.post(
            "/audit-unlock-requests/operational/return-refund",
            payload
          );
        } else {
          await axiosClient.post(
            "/returns",
            payload
          );
        }

        completed += 1;
      }

      await onResult({
        message:
          outcome === "refund"
            ? `${completed} refund request${completed === 1 ? "" : "s"} sent to administrators. No stock or refund records change until approval.`
            : `${completed} returned product${completed === 1 ? "" : "s"} recorded successfully.`,
        error: "",
        pendingApproval: outcome === "refund",
      });
    } catch (requestError) {
      const detail =
        requestError.response?.data
          ?.message ||
        requestError.message ||
        "Failed to record return.";

      await onResult({
        message: "",
        error:
          completed > 0
            ? `${completed} item${
                completed === 1
                  ? ""
                  : "s"
              } submitted before another item failed. ${detail}`
            : detail,
      });
    } finally {
      setSaving(false);
    }
  }

  if (!saleId) {
    return (
      <section className="section-card returns-batch-panel">
        <span className="returns-batch-badge">
          Multi-item return
        </span>

        <h2>
          Return Several Products Together
        </h2>

        <p>
          Select the customer's receipt
          first.
        </p>
      </section>
    );
  }

  return (
    <form
      className="section-card returns-batch-panel"
      onSubmit={submitReturns}
    >
      <span className="returns-batch-badge">
        Multi-item return
      </span>

      <h2>
        Return Several Products Together
      </h2>

      <p className="returns-batch-intro">
        Select every product the customer
        returned, enter each quantity, then
        save them together for{" "}
        <strong>
          {storeCode} — {storeName}
        </strong>
        .
      </p>

      {error ? (
        <div className="error-box">
          {error}
        </div>
      ) : null}

      <div className="returns-batch-lines">
        {lines.map((line) => {
          const unavailable =
            line.remaining_quantity <= 0 || line.active_refund_request_count > 0;

          return (
            <article
              key={line.product_id}
              className={`returns-batch-line ${
                line.selected
                  ? "is-selected"
                  : ""
              }`}
            >
              <label className="returns-batch-check">
                <input
                  type="checkbox"
                  checked={line.selected}
                  disabled={unavailable}
                  onChange={(event) =>
                    selectLine(
                      line.product_id,
                      event.target.checked
                    )
                  }
                />

                <span>
                  <strong>
                    {line.product_name}
                  </strong>

                  <small>
                    Remaining available: {line.remaining_quantity}
                    {line.pending_return_quantity > 0
                      ? ` · Pending approval: ${line.pending_return_quantity}`
                      : ""}
                    {" · "}
                    {formatMoney(line.unit_price)} each
                    {line.active_refund_request_codes.length > 0
                      ? ` · ${line.active_refund_request_codes.join(", ")}`
                      : ""}
                  </small>
                </span>
              </label>

              {line.selected ? (
                <div className="returns-batch-item-fields">
                  <label>
                    Quantity
                    <input
                      type="number"
                      min="1"
                      max={
                        line.remaining_quantity
                      }
                      step="1"
                      value={line.quantity}
                      onChange={(event) =>
                        changeQuantity(
                          line.product_id,
                          event.target.value
                        )
                      }
                    />
                  </label>

                  {outcome === "refund" ? (
                    <label>
                      Refund amount
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        max={
                          line.unit_price *
                          Number(
                            line.quantity ||
                              0
                          )
                        }
                        value={
                          line.refund_amount
                        }
                        onChange={(event) =>
                          changeRefund(
                            line.product_id,
                            event.target
                              .value
                          )
                        }
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="returns-control-grid">
        <label>
          Reason for return
          <textarea
            value={reason}
            onChange={(event) =>
              setReason(
                event.target.value
              )
            }
            placeholder="Wrong size, damaged, customer changed mind…"
          />
        </label>

        <label>
          Return outcome
          <select
            value={outcome}
            onChange={(event) =>
              changeOutcome(
                event.target.value
              )
            }
          >
            <option value="stock_only">
              Stock only — no money returned
            </option>

            <option value="refund">
              Financial refund — send to admin
            </option>
          </select>
        </label>
      </div>

      {outcome === "refund" ? (
        <section className="returns-batch-approval">
          <h3>
            Remote administrator approval
          </h3>
          <p>
            The refund request will appear in every authorized administrator's
            Approval Centre. No administrator password is entered on this device,
            and no stock or money record changes until approval.
          </p>

          <div className="returns-control-grid">
            <label>
              Refund channel
              <select
                name="refund_method"
                value={
                  refundDetails.refund_method
                }
                onChange={
                  changeRefundDetails
                }
              >
                <option value="none">
                  Select channel
                </option>
                <option value="cash">
                  Cash
                </option>
                <option value="momo">
                  Mobile Money
                </option>
                <option value="bank">
                  Bank
                </option>
                <option value="other">
                  Other
                </option>
              </select>
            </label>

            <label>
              Refund reference
              <input
                name="refund_reference"
                value={
                  refundDetails.refund_reference
                }
                onChange={
                  changeRefundDetails
                }
                placeholder="MoMo, bank or written reference"
              />
            </label>
          </div>
        </section>
      ) : null}

      <div className="returns-batch-summary">
        <div>
          <span>Selected products</span>
          <strong>
            {selectedLines.length}
          </strong>
        </div>

        <div>
          <span>Estimated value</span>
          <strong>
            {formatMoney(
              estimatedTotal
            )}
          </strong>
        </div>

        <div>
          <span>Total refund</span>
          <strong>
            {formatMoney(
              outcome === "refund"
                ? refundTotal
                : 0
            )}
          </strong>
        </div>
      </div>

      <button
        type="submit"
        disabled={
          saving ||
          selectedLines.length === 0
        }
      >
        {saving
          ? outcome === "refund"
            ? "Sending Approval Requests…"
            : "Saving Selected Returns…"
          : outcome === "refund"
          ? `Send ${selectedLines.length || ""} Refund Request${selectedLines.length === 1 ? "" : "s"} to Admin`
          : `Save ${selectedLines.length || ""} Selected Return${selectedLines.length === 1 ? "" : "s"}`}
      </button>
    </form>
  );
}
