# Password Change Fix Result

The shared password change path now distinguishes credential validation from session invalidation and performs password/session writes atomically. Permanent regression tests cover both behaviours.

The final branch head preserves the existing desktop post-login resilience contract while keeping wrong-current-password validation on the password page.
