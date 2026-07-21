# PHASE 2.3 C2 Database Backup Record

## Backup Time

Backup time was recorded before continuing Phase 2.3-C3 user entitlement development.

## Backup File

```text
/home/ubuntu/backups/before_c3_user_entitlement.sql
```

## Purpose

Before continuing user entitlement development.

This backup point is used to preserve the current Phase 2.3-C2 state after registration bonus entitlement validation and before entering the next entitlement API development stage.

## Contains

The backup is intended to cover the current user identity and entitlement data needed for rollback or verification:

- `users`
- `wechat_user_bindings`
- `user_entitlements`
- `entitlement_transactions`

## Restore Example

Run from the directory containing the backup file, or use the absolute backup path:

```bash
mysql baxiaota < before_c3_user_entitlement.sql
```

Equivalent absolute-path example:

```bash
mysql baxiaota < /home/ubuntu/backups/before_c3_user_entitlement.sql
```

## Notes

- This is a deployment and development safety backup record.
- Do not restore this backup to production without confirming the target environment and taking a fresh backup first.
- This record does not modify database schema or application code.
