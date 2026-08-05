# Architecture (target)

Early direction — not implemented yet.

```
[ home-site ]          public marketing
[ portal ]             customer UI (future repo)
        \
         →  [ platform API ]  ← device agents (NDI / e-paper)
                    |
              persistence + secrets (Cloudflare / TBD)
```

Prefer one platform API until a product needs an independent deploy cadence.
