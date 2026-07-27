# Password Change Fix Result

The shared password change path now distinguishes credential validation from session invalidation and performs password/session writes atomically. Permanent regression tests cover both behaviours.
