# OneFS SmartSync
## Backup to object

1. **Create and install certificates** => Create CA and identity per dm Peer!
   ```bash
   mkdir /ifs/certs
   cd /ifs/certs
   openssl genrsa -out ca.key 4096
   openssl req -x509 -new -nodes -key ca.key -sha256 -days 1825 -out ca.pem
   openssl genrsa -out identity.key 4096
   openssl req -new -key identity.key -out identity.csr
   cat << EOF > identity.ext
   authorityKeyIdentifier=keyid,issuer\
   basicConstraints=CA:FALSE\   keyUsage=digitalSignature,nonRepudiation,keyEncipherment,dataEncipherment\
   EOF
   openssl x509 -req -in identity.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out identity.crt -days 825 -sha256 -extfile identity.ext
   isi dm certificates ca create --certificate-path=/ifs/certs/ca.pem --name=test-CA
   isi dm certificates identity create --certificate-key-path=/ifs/certs/identity.key --certificate-path=/ifs/certs/identity.crt --name=Test-ID
   isi dm certificates ca list
   isi dm certificates identity list
   ```
2. **Create a target account for ECS**
   ```bash
   isi dm accounts create ECS_S3 --auth-mode=CLOUD --access-id=130971723356320605@ecstestdrive.emc.com --secret-key=RzOvafHiaiTdrvIvZXEHGFaQ5I/X1ard8wgFx9je --name=ECS\ Test\ Drive --uri=https://object.ecstestdrive.com/<bucket_name>
   ``` 
3. **Create a dataset creation policy**
   ```bash
   mkdir /ifs/dm_source
   cp some_data dm_source
   isi dm policies create create4cloud NORMAL true CREATION --creation-account-id=local --creation-base-path=/ifs/dm_source --creation-dataset-retention-period=72000 --creation-dataset-expiry-action=DELETE --start-time="2022-10-12 12:00:00"
   ```
4. **Create a copy policy** (a linked policy to be precise)

   ```bash
   isi dm policies create Backup2ECS --priority=NORMAL --enabled=true --policy-type=REPEAT_COPY --parent-exec-policy-id=1 --repeat-copy-source-base-path=[dm_source]]t --repeat-copy-base-base-account-id=local --repeat-copy-base-source-account-id=local --repeat-copy-base-new-tasks-account=local --repeat-copy-base-target-account-id=[Cloud Account ID] --repeat-copy-base-target-base-path=[target_path] --repeat-copy-base-target-dataset-type=FILE_ON_OBJECT_BACKUP --repeat-copy-base-dataset-retention-period=12000 --repeat-copy-base-dataset-reserve=10 --repeat-copy-base-policy-dataset-expiry-action=DELETE --start-time="2025-05-29 10:20:00"
   ```

5. **Create a clean up policy for local datasets aging**

   ```bash
   isi dm policies create local_cleanup NORMAL true EXPIRATION \
   --expiration-account-id=local \
   --start-time="2022-10-12 12:00:00" \
   --recurrence="0 * * * *"
   ```
6. **Run the job**
   ```bash
   isi dm policies modify --run-now=true 1
   ```
7. **Make it reoccuring by updating the dataset creation policy**
   uses Cron like expression:<br>
   ```<seconds> <minutes> <hours> <day-of-month> <month> <day-of-week> <year>```
   
   <br>**Run a job every hour:**
      ```bash
      isi dm policies modify --recurrence="0 * * * *"
      ``` 

   For the ones who cannot memorize cron expressions: https://crontab.cronhub.io/

   ## Working with Backups
   To access and browse the backup sets from the S3 bucket we use the isi_dm tool. (Note: we dont have this papi fied today.)

   isi_dm is basically the binary frontend of smartsync aka the datamover. The "isi dm" interacts with isi_dm. So technically we could do anything and everything dm with this tool from a clusters cli.

   #### Now, how to access the backuped data with isi_dm?
   Two options:
   1. ```isi_dm object list``` to list the HEAD aka latest version of the backup dataset from an Object Account.
   2. ```isi_dm browse``` starts an interactive cli that allows searching accessing the existing "backup sets" and to download individual files.
   3. create a copy policy to restore data

    #### Backup Listing 
    ```bash
    # isi_dm object list --account-id [ECS Account ID] --target-type=backup --basepath portableOneFS    
    {
   "gfid" : "000C292EAE00437A3568322110D2EB9828801",
   "name" : "portableOneFS",
   "subdir" : [
      {
         "gfid" : "000C292EAE00437A3568322110D2EB9828803",
         "name" : "More_data.txt",
         "size" : "10 bytes",
         "type" : "file"
      },
      {
         "gfid" : "000C292EAE00437A3568322110D2EB9828802",
         "name" : "README.txt",
         "size" : "4 bytes",
         "type" : "file"
      },
      {
         "gfid" : "000C292EAE00437A3568322110D2EB9828804",
         "name" : "data",
         "subdir" : [],
         "type" : "directory"
      }
   ],
   "type" : "directory"
    }
    ```
    The above basicaly allows to retrieve the data structure, however it only shows the latest version of the dataset.

    #### Browsing and downloading
    The interactive ```isi_dm browse``` cli facility allows to switch between accounts and dataset. Access the backed up metadata and to download individual files or folders.

    **Note:** ```help``` gives a list of available commands.

    1. Connect to an object account and select a dataset

        ```bash
        # isi_dm browse
        <no account>:<no dataset> $ list-accounts
        000000000000000100000000000000000000000000000000 (backup2cloud)
        000c292eae00437a3568322110d2eb982880000000000000 (DM Local Account)
        fd0000000000000000000000000000000000000000000000 (DM Loopback Account)
        <no account>:<no dataset> $ connect-account 000000000000000100000000000000000000000000000000
        backup2cloud:<no dataset> $
        backup2cloud:<no dataset> $ list-datasets
        1       2025-05-29T10:40:13+0200        portableOneFS
        2       2025-05-29T11:11:57+0200        portableOneFS
        3       2025-05-29T11:26:10+0200        portableOneFS
        4       2025-05-29T12:30:23+0200        portableOneFS
        5       2025-05-29T14:00:29+0200        portableOneFS
        6       2025-05-29T14:04:38+0200        portableOneFS
        7       2025-05-29T14:08:55+0200        portableOneFS
        backup2cloud:<no dataset> $ connect-dataset 7
        backup2cloud:7 <portableOneFS:> $ 
        ```
    2. ```find``` recursively lists ALL available files and folders from the dataset or a given subfolder but it support no additional filtering.
    ```cd``` and ```ls``` allows to interactively navigate the directory structure.
        * ```find```:
        ```bash
        backup2cloud:7 <portableOneFS:> $ find
        ./data/
        ./More_data.txt
        ./README.txt
        ./file_with_acl
        ./data/f73wg84xLnbANTr_dir/
        ./data/oc6yhDj94xgDj942wLnGla5x_dir/
        ./data/DATASET.INFO
        ./data/f73wg84xLnbANTr_dir/AiEPp_dir/
        ./data/f73wg84xLnbANTr_dir/AiEPp_dir/jEkaANTWYZZZuf731vf_dir/
        ./data/f73wg84xLnbANTr_dir/AiEPp_dir/qd6yhDOUXYuKnGla5xg8zMoc63_1_reg
        ./data/f73wg84xLnbANTr_dir/AiEPp_dir/jEkaANTWYZZZuf731vf_dir/qd6yhDj9421vKSrImbANTrdBiE_dir/
        ./data/f73wg84xLnbANTr_dir/AiEPp_dir/jEkaANTWYZZZuf731vf_dir/qd6yhDj9421vKSrImbANTrdBiE_dir/qd6yMTWYuKSWte7yMTWtJmb521_dir/
        ./data/f73wg84xLnbANTr_dir/AiEPp_dir/jEkaANTWYZZZuf731vf_dir/qd6yhDj9421vKSrImbANTrdBiE_dir/qd6yMTWYuKSWte7yMTWtJmb521_dir/Cj9zh8z_dir/
        ./data/oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/
        ./data/oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/sub_dir1/
        ```
        * ```cd``` and ```ls```
        ```bash
        backup2cloud:7 <portableOneFS:> $ ls
        More_data.txt                  [file]
        README.txt                     [file]
        data                           [dir]
        file_with_acl                  [file]
        backup2cloud:7 <portableOneFS:> $ cd data
        backup2cloud:7 <portableOneFS:data/> $ ls
        DATASET.INFO                   [file]
        f73wg84xLnbANTr_dir            [dir]
        oc6yhDj94xgDj942wLnGla5x_dir   [dir]
        ```
    3. download selected files or folders<br>```download```retrieves selected data, however it is not a "restore" facility as it does not retrieve the original security descriptors.
        ```bash
        backup2cloud:7 <portableOneFS:data/> $ download oc6yhDj94xgDj942wLnGla5x_dir /ifs/data/restore/testfolder
        oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/             -> /ifs/data/restore/testfolder/oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/
        oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/sub_dir1/ -> /ifs/data/restore/testfolder/oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/sub_dir1/
        oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/vf7y_1_reg   -> /ifs/data/restore/testfolder/oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/vf7y_1_reg
        oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/sub_dir1/sub_dir2/ -> /ifs/data/restore/testfolder/oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/sub_dir1/sub_dir2/
        oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/sub_dir1/sub_dir2/sub_dir3/ -> /ifs/data/restore/testfolder/oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/sub_dir1/sub_dir2/sub_dir3/
        oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/sub_dir1/sub_dir2/afile -> /ifs/data/restore/testfolder/oc6yhDj94xgDj942wLnGla5x_dir/100v_dir/sub_dir1/sub_dir2/afile
        ...
        backup2cloud:3 <portableOneFS:> $ download README.txt /ifs/data/README.original.txt
        backup2cloud:3 <portableOneFS:> $
        ```

    ### Restore from Cloud
    The data can be restored from the same cluster or a different cluster pointing to the same cloud account.

    Data can be pulled in via a COPY policy. Note a copy policy can only be run once!
    The target directory must be empty, if it doesn't exist the process does create it.

    #### Full restore from a given dataset:

    ```bash
    isi dm policies create RestoreFromECS\
    --priority=NORMAL \
    --enabled=true \
    --policy-type=COPY \
    --copy-dataset-id=6 \
    --copy-source-base-path=portableOneFS \
    --copy-create-dataset-on-target=false \
    --copy-base-source-account-id=000000000000000100000000000000000000000000000000 \
    --copy-base-target-account-id=local \
    --copy-base-target-base-path=/ifs/data/restore \
    --copy-base-target-dataset-type=FILE \
    --start-time="2025-05-29 10:20:00"
    ```
    #### Single File Restore
    with the option ```copy-source-subpaths``` it's possible to specify a single file or folder in the source dataset to be retrieved. Contrary to the ```download``` option in ```isi_dm browse``` this restores the file including the original security descriptor.

    ```bash
    isi dm policies create SingleFileRestore\
    --priority=NORMAL \
    --enabled=true \
    --policy-type=COPY \
    --copy-dataset-id=7 \
    --copy-source-base-path=portableOneFS \
    --copy-source-subpaths=file_with_acl \
    --copy-create-dataset-on-target=false \
    --copy-base-source-account-id=000000000000000100000000000000000000000000000000 \
    --copy-base-target-account-id=local \
    --copy-base-target-base-path=/ifs/data/restore \
    --copy-base-target-dataset-type=FILE \
    --start-time="2025-05-29 10:20:00"
    ```
    
    ### PowerScale to PowerScale DM Communications
    Create a ```DM``` account of the second cluster allows the following:
    1. create PULL policies, where all the primary work is done on the local cluster
        - start PowerScale to PowerScale replications 
        - Pull data in on demand using a one-off COPY policy
        - Pull and PUSH to Cloud
    2. Browse and download from remote datasets

    ***Usecases:***<br>
    1. Cyber: Golden Copy to a Vault: no administation on the source system, only visible artefact are the datasets created. <br>Local cluster does not manage the replication and cannot compromise the replicated data.
    2. Data distribution / collaboration:
        - multiple clusters connect to each other
        - datasets created locally 
        - each cluster can pull or download data on demand
        - critical data can be distrubuted to all systems. 

    ### Access from or with a 2nd Cluster

    1. Install a certificate with the same CA as above
    2. create the same Could account
    3. start browsing

    ```bash
    sec-1# isi_dm browse
    <no account>:<no dataset> $ list-accounts
    000000000000000108000000000000000000000000000000 (ECS Test Drive)
    000c29f6a733f46f3868ad03c04a1aee2790000000000000 (DM Local Account)
    fd0000000000000000000000000000000000000000000000 (DM Loopback Account)
    <no account>:<no dataset> $ connect-account 000000000000000108000000000000000000000000000000
    ECS Test Drive:<no dataset> $ list-datasets
    1       2025-05-29T10:40:13+0200        portableOneFS
    2       2025-05-29T11:11:57+0200        portableOneFS
    3       2025-05-29T11:26:10+0200        portableOneFS
    4       2025-05-29T12:30:23+0200        portableOneFS
    5       2025-05-29T14:00:29+0200        portableOneFS
    6       2025-05-29T14:04:38+0200        portableOneFS
    7       2025-05-29T14:08:55+0200        portableOneFS
    8       2025-05-29T16:00:23+0200        portableOneFS
    ECS Test Drive:<no dataset> $ connect-dataset 8
    ECS Test Drive:8 <portableOneFS:> $ ls
    More_data.txt                  [file]
    README.txt                     [file]
    data                           [dir]
    file_with_acl                  [file]
    ECS Test Drive:8 <portableOneFS:> $ download README.txt /ifs/data/README.restored
    ECS Test Drive:8 <portableOneFS:> $
    ECS Test Drive:8 <portableOneFS:> $
    ECS Test Drive:8 <portableOneFS:> $
    ECS Test Drive:8 <portableOneFS:> $ find
    ./data/
    ./More_data.txt
    ./README.txt
    ./file_with_acl
    ./data/f73wg84xLnbANTr_dir/
    ./data/oc6yhDj94xgDj942wLnGla5x_dir/
    ./data/DATASET.INFO
    ./data/f73wg84xLnbANTr_dir/AiEPp_dir/
    ./data/f73wg84xLnbANTr_dir/AiEPp_dir/jEkaANTWYZZZuf731vf_dir/
    ./data/f73wg84xLnbANTr_dir/AiEPp_dir/qd6yhDOUXYuKnGla5xg8zMoc63_1_reg
    ./data/f73wg84xLnbANTr_dir/AiEPp_dir/jEkaANTWYZZZuf731vf_dir/qd6yhDj9421vKSrImbANTrdBiE_dir/
    ...
    ```
    3. or restore as if it was the original cluster...<br>Change ```--copy-base-source-account-id``` to match the potentially different account id of the target clusters dm configuration.

    #### PULL to Object from someone elses Cluster...

    1. create a dataset creation policy for the remote cluster

        ```bash
        isi dm policies create on_sec NORMAL true CREATION --creation-account-id=000000000000000104000000000000000000000000000000 --creation-base-path=/ifs/data/Documents --creation-dataset-retention-period=72000 --creation-dataset-expiry-action=DELETE --start-time="2022-10-12 12:00:00"

        ```
    2. create PULL copy policy 
        ```bash
        isi dm policies create Backup_SEC_2_ECS\
        --priority=NORMAL\
        --enabled=true\
        --policy-type=REPEAT_COPY\
        --parent-exec-policy-id=8193\
        --repeat-copy-source-base-path=/ifs/data/Documents\
        --repeat-copy-base-base-account-id=local\
        --repeat-copy-base-source-account-id=000000000000000104000000000000000000000000000000\
        --repeat-copy-base-new-tasks-account=local\
        --repeat-copy-base-target-account-id=000000000000000100000000000000000000000000000000\
        --repeat-copy-base-target-base-path=fromSEC\
        --repeat-copy-base-target-dataset-type=FILE_ON_OBJECT_BACKUP\
        --repeat-copy-base-dataset-retention-period=12000\
        --repeat-copy-base-dataset-reserve=10\
        --repeat-copy-base-policy-dataset-expiry-action=DELETE
        --start-time="2025-05-29 10:20:00"
        ```

    3. Run the dataset creation policy manually ```--run-now=true``` or schedule it ```--recurrence```.

## APPENDIX
### Review metadata from a given file.
```bash
backup2cloud:3 <portableOneFS:> $ stat README.txt
gstat:{
    gfile_id = {guid={dmg_guid=000c292eae00437a3568322110d2eb982880} local_unid=2}
    mode = 000000100600
    nlink = 1
    uid = 0
    gid = 0
    rdev = -1
    atime = 2025-05-29T10:51:19+0200
    mtime = 2025-05-29T10:51:19+0200
    ctime = 2025-05-29T10:51:19+0200
    birthtime = 2025-05-29T10:51:19+0200
    size = 1037
    flags = file
}
sd: {
    sd_info = DACL_SECURITY_INFORMATION
    sd_data = { control=32772 owner=<NULL>  group=<NULL>  dacl={ ace_count=3 aces=[ { ace_type=0x00 ace_flags=0x00 ace_rights=0x00120089 ace_trustee=type:DM_PERSONA_UID size:8 uid:13  }, { ace_type=0x00 ace_flags=0x00 ace_rights=0x0016019f ace_trustee=type:DM_PERSONA_UID size:8 uid:0  }, { ace_type=0x00 ace_flags=0x00 ace_rights=0x00120080 ace_trustee=type:DM_PERSONA_GID size:8 gid:0  } ] } sacl=<NULL> }
}
extattr: {
    extattr_num = 0
    extattr_names =
    extattr_values = []
}
sysattr: {
    sysattr_num = 3
    sysattr_values = [ { dmsa_name=ST_FLAG dmsa_value=00000000 dmsa_value_size=4 dmsa_fs_type=DM_FS_TYPE_ONEFS dmsa_fs_version=0xffffffffffffffff }, { dmsa_name=HDFSRAW dmsa_value=0000000000000000080000000000000080000000000000004000100000000000 dmsa_value_size=32 dmsa_fs_type=DM_FS_TYPE_ONEFS dmsa_fs_version=0xffffffffffffffff }, { dmsa_name=MD5_VAL dmsa_value=00 dmsa_value_size=1 dmsa_fs_type=DM_FS_TYPE_ONEFS dmsa_fs_version=0xffffffffffffffff } ]
}
Parent gfid count #1:
Parent info count #1:
Parent gfid #0: {guid={dmg_guid=000c292eae00437a3568322110d2eb982880} local_unid=1}
{digest=b01eeed0ec6fc4f4799e44c7b4084e64}
```
