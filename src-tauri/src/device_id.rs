//! The device evidence of the first-use trial plan: a SHA-256 of the operating
//! system's machine id, sent with the device authorisation and the trial claim.
//! The id itself never leaves the computer.
//!
//! - Windows: `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` (64-bit view).
//! - macOS: `IOPlatformUUID`, from `ioreg -rd1 -c IOPlatformExpertDevice`.
//! - Linux: `/etc/machine-id`, else `/var/lib/dbus/machine-id`.
//!
//! When the id cannot be read, there is no hash and the field is left out: the
//! gateway reads a missing hash as "no device evidence".
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

/// Versions the hash, so a later scheme cannot match an old one by accident.
const PREFIX: &str = "lynshen-desktop-device-v1:";

/// `hex(SHA-256(PREFIX + id.trim().to_lowercase()))`, 64 lowercase hex digits.
/// None for an id that names no machine: empty, or only zeros and separators
/// (the placeholder some virtual machines report).
pub(crate) fn device_hash_of(machine_id: &str) -> Option<String> {
    let id = machine_id.trim().to_lowercase();
    if !id.chars().any(|c| c.is_alphanumeric() && c != '0') {
        return None;
    }
    let digest = Sha256::digest(format!("{PREFIX}{id}").as_bytes());
    Some(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// This computer's device hash, read once per run (macOS starts a process for it).
pub(crate) fn device_hash() -> Option<String> {
    static HASH: OnceLock<Option<String>> = OnceLock::new();
    HASH.get_or_init(|| machine_id().as_deref().and_then(device_hash_of)).clone()
}

/// The `IOPlatformUUID` value in the output of `ioreg -rd1 -c
/// IOPlatformExpertDevice` (a line `"IOPlatformUUID" = "…"`).
#[cfg(any(target_os = "macos", test))]
fn ioreg_platform_uuid(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        if key.trim() != "\"IOPlatformUUID\"" {
            return None;
        }
        let value = value.trim().trim_matches('"').trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

/// The id in a machine-id file. A file systemd has not filled yet holds
/// `uninitialized`, which names no machine.
#[cfg(any(target_os = "linux", test))]
fn machine_id_file_value(text: &str) -> Option<String> {
    let id = text.trim();
    (!id.is_empty() && id != "uninitialized").then(|| id.to_string())
}

#[cfg(target_os = "windows")]
fn machine_id() -> Option<String> {
    // The 64-bit view, also from a 32-bit build (WOW64 would redirect the key).
    const KEY_WOW64_64KEY: u32 = 0x0100;
    windows_registry::LOCAL_MACHINE
        .options()
        .read()
        .access(KEY_WOW64_64KEY)
        .open(r"SOFTWARE\Microsoft\Cryptography")
        .ok()?
        .get_string("MachineGuid")
        .ok()
}

#[cfg(target_os = "macos")]
fn machine_id() -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    ioreg_platform_uuid(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(target_os = "linux")]
fn machine_id() -> Option<String> {
    ["/etc/machine-id", "/var/lib/dbus/machine-id"]
        .iter()
        .find_map(|path| machine_id_file_value(&std::fs::read_to_string(path).ok()?))
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn machine_id() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values: `printf '%s' 'lynshen-desktop-device-v1:<id>' | shasum -a 256`.
    #[test]
    fn hash_of_a_known_id() {
        assert_eq!(
            device_hash_of("4c4c4544-0042-3510-8051-b4c04f4e3132").as_deref(),
            Some("24401ae4dace2b94ffa466898373967a78f2b066a98891c8f94b41590cef7cdd")
        );
        assert_eq!(
            device_hash_of("0123456789abcdef0123456789abcdef").as_deref(),
            Some("83870696cbee2ba8c46119f2af7b94094a6511d9de5b804242a1b6f645552243")
        );
    }

    #[test]
    fn the_id_is_trimmed_and_lowercased_before_hashing() {
        assert_eq!(
            device_hash_of("  4C4C4544-0042-3510-8051-B4C04F4E3132\r\n"),
            device_hash_of("4c4c4544-0042-3510-8051-b4c04f4e3132")
        );
    }

    #[test]
    fn no_hash_for_an_id_that_names_no_machine() {
        assert_eq!(device_hash_of(""), None);
        assert_eq!(device_hash_of(" \n"), None);
        assert_eq!(device_hash_of("00000000-0000-0000-0000-000000000000"), None);
    }

    #[test]
    fn the_platform_uuid_is_read_from_ioreg_output() {
        let output = r#"+-o J316sAP  <class IOPlatformExpertDevice, id 0x100000201, registered, matched, active, busy 0 (2 ms), retain 36>
    {
      "IOPlatformSerialNumber" = "C02XXXXXXXXX"
      "compatible" = <"J316sAP","MacBookPro18,1","AppleARM">
      "IOPlatformUUID" = "4C4C4544-0042-3510-8051-B4C04F4E3132"
      "IOConsoleSecurityInterest" = IOCommand is not serializable
    }
"#;
        assert_eq!(
            ioreg_platform_uuid(output).as_deref(),
            Some("4C4C4544-0042-3510-8051-B4C04F4E3132")
        );
        assert_eq!(ioreg_platform_uuid("{\n  \"IOPlatformSerialNumber\" = \"C02\"\n}\n"), None);
        assert_eq!(ioreg_platform_uuid("  \"IOPlatformUUID\" = \"\"\n"), None);
    }

    #[test]
    fn machine_id_files() {
        assert_eq!(
            machine_id_file_value("0123456789abcdef0123456789abcdef\n").as_deref(),
            Some("0123456789abcdef0123456789abcdef")
        );
        assert_eq!(machine_id_file_value("\n"), None);
        assert_eq!(machine_id_file_value("uninitialized\n"), None);
    }
}
