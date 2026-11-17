# Security notes

One plain sentence per table: **who reads, who writes**. If the sentence is hard to
write, the policy is probably wrong. smugan's `security-notes` check requires one
entry per table created in a migration.

Suggested format:

```
- Table `example_table`: visitors read nothing; signed-in users read and edit only
  their own records; administrators access everything only from the server (service_role).
```

## Tables
