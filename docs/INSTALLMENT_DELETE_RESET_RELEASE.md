# Installment deletion/reset release note

This release consolidates Installment Finance customer and excavator deletion and full workspace reset through one transactional backend deletion engine.

- Individual customer deletion is ID-scoped.
- Individual excavator deletion is ID-scoped.
- Shared master records remain when referenced outside Installment Finance.
- Full reset clears the Installment workspace scope only.
- Reset preview and reset execution use the same scope collector.
