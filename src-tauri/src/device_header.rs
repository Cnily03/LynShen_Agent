//! The gateway device header (`X-LynShen-Device`, gateway spec
//! `authorized-devices.spec.md` AD-H1) on the app's own gateway calls.
//!
//! The bundled LynShen CLI computes it (`lynshen device-id`), so the app and the
//! engine send the same value and the computer's identifiers are read by one
//! implementation. It is read once per run. A CLI that predates the command,
//! or a build without a bundled CLI, gives none: the gateway then treats the
//! app as an old client (allowed until its `strict` mode).
use serde_json::Value;
use std::io::Read;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// The `(header, value)` the CLI printed, when it printed a usable one.
pub(crate) fn parse_cli_output(stdout: &str) -> Option<(String, String)> {
    let value: Value = serde_json::from_str(stdout.trim()).ok()?;
    let name = value["header"].as_str()?.trim();
    let header = value["value"].as_str()?.trim();
    let valid_name = name.eq_ignore_ascii_case("x-lynshen-device");
    // A header value must be visible ASCII; the CLI's is base64url and digits.
    let valid_value = header.starts_with("v1;") && header.len() <= 1024 && header.bytes().all(|b| (0x20..0x7f).contains(&b));
    (valid_name && valid_value).then(|| (name.to_string(), header.to_string()))
}

/// How long `lynshen device-id` may take (macOS runs `ioreg` twice).
const CLI_TIMEOUT: Duration = Duration::from_secs(5);

fn read_from_cli() -> Option<(String, String)> {
    let path = crate::app_cli::path()?;
    let mut command = std::process::Command::new(path);
    // A CLI older than the command would start its TUI: with no input and the
    // timeout below it ends instead of waiting.
    command
        .arg("device-id")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::no_window(&mut command);
    let mut child = command.spawn().ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) | Err(_) => return None,
            Ok(None) if started.elapsed() >= CLI_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
        }
    }
    let mut stdout = String::new();
    child.stdout.take()?.read_to_string(&mut stdout).ok()?;
    parse_cli_output(&stdout)
}

/// This computer's device header, or None.
pub(crate) fn header() -> Option<&'static (String, String)> {
    static HEADER: OnceLock<Option<(String, String)>> = OnceLock::new();
    HEADER.get_or_init(read_from_cli).as_ref()
}

/// `request` with the device header, when there is one.
pub(crate) fn apply(request: ureq::Request) -> ureq::Request {
    match header() {
        Some((name, value)) => request.set(name, value),
        None => request,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cli_output_is_read_and_checked() {
        let good = r#"{"header":"X-LynShen-Device","value":"v1;hw=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA;os=macos;cli=0.8.0"}"#;
        assert_eq!(
            parse_cli_output(good),
            Some((
                "X-LynShen-Device".to_string(),
                "v1;hw=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA;os=macos;cli=0.8.0".to_string()
            ))
        );
        // Nothing readable on this computer, another header, or garbage: none.
        assert_eq!(parse_cli_output(r#"{"header":"X-LynShen-Device","value":null}"#), None);
        assert_eq!(parse_cli_output(r#"{"header":"Authorization","value":"v1;hw=x"}"#), None);
        assert_eq!(parse_cli_output(r#"{"header":"X-LynShen-Device","value":"v1;host=a\nb"}"#), None);
        assert_eq!(parse_cli_output("lynshen: unknown command"), None);
        assert_eq!(parse_cli_output(""), None);
    }
}
