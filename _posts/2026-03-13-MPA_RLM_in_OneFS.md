---
layout: page
title: OneFS 9.12+ Secure Snapshots and Root Lockdown 
tags: OneFS PowerScale Snapshots Security
---
# OneFS Secure Snapshots, Multi-Party Authorization, and Root Lockdown Mode
## Introduction

This manual provides concise steps for configuring PowerScale OneFS Secure Snapshots, enabling Multi-Party Authorization (MPA), and applying Root Lockdown Mode (RLM), as introduced in OneFS 9.12 and later. These features enhance privileged operation security and resilience against cyber-attacks.

**References:**

- [OneFS Secure Snapshots - Unstructured Data Quick Tips](http://www.unstructureddatatips.com/onefs-secure-snapshots/)
- [PowerScale OneFS Security Considerations - Dell InfoHub](https://infohub.delltechnologies.com/en-us/l/dell-powerscale-onefs-security-considerations-1/powerscale-onefs-zero-trust-7/)
- [Online TOTP Generator for MFA](https://totp.app/)

**Requirements:**

- PowerScale OneFS 9.12 or later
- Licensed SnapshotIQ and Hardening

**Key Concepts:**

- **Secure Snapshots:** Implements a four-eyes principle for snapshot management using MPA.
- **Multi-Party Authorization (MPA):** Requires one or more additional trusted parties to approve certain privileged actions. MPA uses Time-based One-Time Passwords (TOTP) via any authenticator app or browser tool (e.g., Google Authenticator, Microsoft Authenticator, [totp.app](https://totp.app/)).
- **Root Lockdown Mode (RLM):** Disables 'root' account access, further securing against unauthorized actions, managed via Configurable Hardening Engine (CHE).

MPA and RLM together significantly enhance operational security and reduce risk of malicious or accidental administrative actions.

## Step 1: Enabling Multi-Party Authorization (MPA)

The following steps are performed using the clusters WebUI. The approval administrators require access to the Cluster via the System Access Zone.

- **Create Local User as required**
    - Create one or more local admin users as needed.
    - For the next steps we assume the cluster is joined to the demo.local active directory domain.

- **Assign Admins to ApprovalAdmin Role**
    - Navigate to: Access → Membership and roles → Roles Tab
    - Edit the ApprovalAdmin role to add designated admin users.
    - Make sure the "local" admin user is added as approver!

- **Register Authorizers**
    - As root, go to Access → Multi-Party Authorization → Registration
    - Click 'Register' and follow instructions. Register 'root' as authorizer.
    - Note: Even root cannot bypass MPA once configured. Later, root access can be fully removed.

- **Log in as Admin User and Register**
    - Log out, then log in as the admin user.
    - Complete their approval registration as above.

- **Enable MPA**
    - Navigate to: Access → Multi-Party Authorization → Settings
    - Click 'Enable'
    - **Important:** MPA cannot be disabled once set up.

    **TOTP Setup:** Use any standard authenticator app. For testing, [totp.app](https://totp.app/) is a browser-based tool.

## Step 2: Demonstrating MPA Workflow

- **Add Additional ApprovalAdmin**
    - As root, add another user (e.g., DEMO/jwick) to the ApprovalAdmin Role.

- **Register New ApprovalAdmin**
    - Log out and log in as the new user.
    - This user will see a restricted web UI view.
    - Navigate to Access → Multi-Party Authorization and attempt registration.  
    This raises an approval request.

- **Approve Registration**
    - Log in as admin or root to approve new ApprovalAdmin registration.
    - Once approved, user is now part of ApprovalAdmin.  
- **Note:** 
    - Re-registration always requires approval. Users cannot approve their own requests (including root).
    - Denying re-registration **disables** the user from future approvals.

## Step 3: Working with Secure Snapshots

| Operation                                   | MPA Required?           |
| ------------------------------------------- | ----------------------- |
| Create ad-hoc snapshot with no expiration   | No                      |
| Delete ad-hoc snapshot                      | No (considered expired) |
| Create scheduled snapshot (with expiry)     | No                      |
| Delete snapshot after expiration            | No                      |
| Delete snapshot before expiration           | Yes                     |
| Modify snapshot schedule                    | Yes                     |
| Delete scheduled snapshot before expiration | Yes                     |
| Reduce expiry date                          | Yes                     |
| Rename to reserved name                     | Yes                     |

-> Deleting snapshots without retention time set is considered safe and does not require approval.

-> Modifying schedules or deleting non-expired scheduled snapshots requires MPA approval.

## Step 4: Protecting Retention against System Time changes with RBAC

OneFS uses system time for snapshot retention. Changing cluster time can cause immediate expiry of snapshots. To prevent unauthorized time changes:

- Copy the SystemAdmin role to a new role called 'SecuredSystemAdmin'.
- For the new role, set "Time" privilege to "-".
- Assign necessary users to SecuredSystemAdmin and remove from SystemAdmin.
- Check that "Cluster management → General Settings" no longer shows time modification options.
- Optionally, remove NTP configuration privileges from the secured role.

- Only root can change system time now. For additional control, enable Root Lockdown Mode.

## Step 5: Enabling Root Lockdown Mode (RLM)

**Note:** Currently a CLI-only workflow. Requires MPA approval and a cluster reboot.

- **Configure compadmin Account**

- Enable compadmin and set login shell:
    ```
    isi auth users modify --enabled=true --shell /usr/local/bin/zsh compadmin  
    isi auth users reset-password compadmin  
    isi auth users change-password compadmin
    ```
- **Edit Sudoers (isi_visudo)**

- Add commands for compadmin or any user who requires access to additional cli only commands:

    ```
    compadmin ALL=(ALL) /usr/sbin/isi_mpa_check isi cluster time modify \*
    compadmin ALL=(ALL) /usr/sbin/isi_for_array \*
    ```

    Alternatively, but potentially dangerous, to allow isi_for_array for everyone: 
```ALL ALL=(ALL) /usr/sbin/isi_for_array \*```

- **Apply Hardening Profile**

    - List profiles:
    
        ```isi hardening list```
      
    - View hardening report
    
        ```isi hardening report view root-lockdown```
    
    - Apply root-lockdown profile:
    
        ```isi hardening apply root-lockdown```
      
      **Note**: this will only generate an MPA request.
      Have it approved via MPA and rerun the command.
    - Chech the hardening report again
    - now reboot the cluster.

**How do I use isi_elevate_root?**

- First, configure and enable the Multi Party Authorization feature and RLM.
- Next, give the ISI_PRIV_ELEVATE_ROOT privilege to accounts that should be permitted to elevate to root. As a user with ISI_PRIV_ELEVATE_ROOT run:

    ```sudo isi_mpa_check --fail-if-mpa-disabled /usr/bin/isi_elevate_root```

    This should create a MPA request for elevating to root. Approve the created MPA request with one of the approver-accounts.

- Be aware that **compadmin** does **NOT** have the ISI_PRIV_ELEVATE_ROOT privilege by default!
- Finally, rerun the command to start the elevated shell.

**Testing and Verification:**

- File system access follows user permissions, if a user requires to mangle permissions, add the user to the BACKUPADMIN role.
- Attempt to change system time using date command should fail.
- Change system time with:

    ```sudo isi_mpa_check isi cluster time modify 202510301500```

    **Note:** This requires MPA approval each time, depending on retention as  
    provided by approver.

- Run a command on all nodes on a cluster with isi_for_array:

    ```sudo isi_for_array -s hostname```

    **Note:** this requires NO MPA approval.

- Elevate to root (for rare occasions) with:

    ```sudo isi_mpa_check --fail-if-mpa-disabled /usr/bin/isi_elevate_root```

    Requires MPA approval.

**Disabling RLM:**

- List current profiles:

    ```isi hardening list```

- View hardening report

    ```isi hardening report view root-lockdown```

- Disable root-lockdown

    ```isi hardening disable root-lockdown```

    This also requires MPA approval and a reboot.

- Review the report again

    ```isi hardening report view root-lockdown```

    **Note:** Not all RLM Settings have been revoked initially: run "isi hardening disable root-lockdown" again.

## Conclusion

- Combining Secure Snapshots, MPA, and RLM leads to significant improvements in operational security.
- Plan your security posture and implement role-based controls and multifactor authentication.
- Regularly review access permissions and audit system behavior.
- Security is an ongoing process-regular assessments and updates are key.
