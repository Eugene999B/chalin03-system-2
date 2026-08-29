(() => {
  const run = () => {
    const root = document.querySelector('.equipment-catalogue');
    if (!root) return;
    const row = root.querySelector('.equipment-catalogue__filters');
    if (!row || row.querySelector('#chalin03-equipment-availability-status')) return;

    const field = document.createElement('label');
    field.className = 'equipment-catalogue__availability-filter';

    const title = document.createElement('span');
    title.textContent = 'Availability status';

    const select = document.createElement('select');
    select.id = 'chalin03-equipment-availability-status';
    select.setAttribute('aria-label', 'Filter excavators by availability status');
    select.innerHTML = [
      ['', 'All excavators'],
      ['available', 'Available for a new installment'],
      ['installment_active', 'Under installment agreement'],
      ['reserved', 'Reserved / held for a transaction'],
      ['sold', 'Sold / completed sale'],
      ['not_for_sale', 'Not offered for installment sale'],
    ].map(([value, text]) => `<option value="${value}">${text}</option>`).join('');

    const hint = document.createElement('small');
    hint.textContent = 'Catalogue filter only. It is not part of Installment Finance.';

    field.append(title, select, hint);
    row.appendChild(field);

    select.addEventListener('change', () => {
      const native = [...row.querySelectorAll('select')].find((candidate) =>
        candidate !== select && [...candidate.options].some((option) => option.value === select.value)
      );
      if (native) {
        native.value = select.value;
        native.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
