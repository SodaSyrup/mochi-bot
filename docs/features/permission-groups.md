# Permission groups

Permission Groups lets several Discord categories use one shared permission set
in the Mochi dashboard. Use it when each project has its own category and role,
but studio, partner, or moderation roles need the same access in all projects.

## Permission layers

A group contains:

- one or more Discord categories;
- category-level role rules; and
- optional channel-level role overrides; and
- explicit Allow or Deny states for selected channel permissions.

`Inherit` means that Mochi does not manage the permission. Category rules
provide the shared default. A channel override can give a role a different
state on one child channel. For example, it can deny `Send Messages` on an
announcement channel while allowing it on other channels. Mochi updates only
the explicit permissions in the group rules. It does not change overwrites for
project roles, other roles, members, or unmanaged permission bits.

Each category may belong to only one permission group. This prevents two groups from competing over the same category.

The dashboard also reads existing role overwrites from Discord. It shows them
under **Existing Discord permissions** with their current Allow/Deny states.
Choose **Edit** to add an existing category or child-channel overwrite to a
Mochi group.

## Using the dashboard

1. Open `/permission-groups` and choose **New group**.
2. Name the group and select its project categories. The picker shows Discord's
   category and channel tree, including uncategorized channels. You can see the
   full server layout while you choose categories.
3. Add each shared role, such as a studio or partner role.
4. Set the category defaults to **Allow** or **Deny** and leave everything else as **Inherit**.
5. Add a channel override when one child channel needs a different setting. You can configure announcement, forum, voice, stage, and other channel types separately.
6. Choose **Save and apply**.

Use **Sync** to apply the saved shared layer again after direct changes in
Discord. Editing or deleting a group removes permissions owned by the old group
layer. It leaves unrelated overwrites unchanged.

## Discord requirements

Mochi needs **Manage Roles**. Its bot role must be above every role whose overwrites it manages. The dashboard user must have **Manage Server**, as with other server controls.
