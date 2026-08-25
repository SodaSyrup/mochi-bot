# Permission groups

Permission Groups lets several Discord categories behave like one logical category in the Mochi dashboard. It is intended for servers where every project has its own category and project role, while studio, partner, or moderation roles need the same access across all projects.

## Permission layers

A group contains:

- one or more Discord categories;
- category-level role rules; and
- optional channel-level role overrides; and
- explicit Allow or Deny states for selected channel permissions.

`Inherit` means Mochi does not manage that permission. Category rules provide the shared default, while a channel override can give a role a different state on one child channel—for example, denying `Send Messages` on an announcement channel while allowing it elsewhere. Mochi updates only the explicit permissions in the group's rules. Overwrites for each project's own role, other roles, members, and unmanaged permission bits remain untouched.

Each category may belong to only one permission group. This prevents two groups from competing over the same category.

The dashboard also reads existing role overwrites from Discord. They appear under **Existing Discord permissions** with their current Allow/Deny states; choose **Edit** to bring an existing category or child-channel overwrite into the appropriate Mochi group.

## Using the dashboard

1. Open `/permission-groups` and choose **New group**.
2. Name the group and select the project categories it should contain. The picker mirrors Discord's category/channel tree, including uncategorized channels, so the full server layout remains visible while choosing categories.
3. Add each shared role, such as a modding studio or partner studio role.
4. Set the category defaults to **Allow** or **Deny** and leave everything else as **Inherit**.
5. Add a channel override when one child channel needs different behavior. Announcement, forum, voice, stage, and other channel types can be configured individually.
6. Choose **Save and apply**.

Use **Sync** to reapply the saved shared layer if permissions were changed directly in Discord. Editing or deleting a group also removes permissions that the old group layer owned while leaving unrelated overwrites alone.

## Discord requirements

Mochi needs **Manage Roles** and its bot role must sit above every role whose overwrites it manages. The dashboard user must have **Manage Server**, like other guild-scoped Mochi controls.
