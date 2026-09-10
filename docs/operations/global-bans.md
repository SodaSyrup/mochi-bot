# Global protection operations

Monitor the dashboard's synchronization status, cache age, and pending job
count. The system is healthy when the local cursor advances and the cache stays
within its configured freshness window.

If the Worker is unavailable:

1. Confirm the Worker and D1 status.
2. Check that `GLOBAL_BANS_SYNC_TOKEN` still matches the Worker secret.
3. Keep the bot running if the cache is fresh; it will retry automatically.
4. Expect new enforcement to downgrade to alerts after the maximum cache age.
5. Use `GLOBAL_BANS_ENFORCEMENT_ENABLED=false` as the local emergency switch.

If Discord permissions fail, fix `Ban Members` and the configured alert-channel
permissions in the affected server. Then use the dashboard reconciliation
action. Reconciliation is idempotent and resumes jobs after a process restart.

Do not manually delete D1 event rows to repair a cursor. The event feed is the
audit trail. Take a backup before you use a snapshot and synchronization
procedure.
