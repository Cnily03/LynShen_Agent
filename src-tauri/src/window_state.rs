//! When the main window's size and position reach the disk.
//!
//! tauri-plugin-window-state keeps the geometry in memory and writes its file
//! (`.window-state.json` in the app config dir) only on `RunEvent::Exit`.
//! On Windows an update install never gets there: the updater starts the
//! installer and calls `std::process::exit`. Task Manager kills and crashes
//! end the same way, and a closed main window only hides to the tray, so the
//! process often lives until the next update. Every size change since the
//! last clean exit was lost (ticket #58). So the file is also written before
//! an update installs, when the main window hides, and about a second after
//! the last resize or move.
//!
//! `save` must run on the main thread: the plugin locks its cache and then
//! asks the window for its geometry, which from another thread is a round
//! trip to the main thread, and the plugin's own Resized / Moved listeners
//! lock the same cache there.

use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Window};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// What the window-state plugin restores. Not decorations: a state saved by
/// a version with the native title bar (0.3.x) would bring it back over the
/// drawn one. Not visibility: the app creates the main window hidden and
/// shows it itself once it has its background, or not at all on a silent
/// launch at login (main_window::create). With visibility the plugin would
/// show the window as soon as it is ready, before either.
pub(crate) fn flags() -> StateFlags {
    StateFlags::all() - StateFlags::DECORATIONS - StateFlags::VISIBLE
}

/// How long the window has to be still after a resize or move before the
/// file is written.
const QUIET: Duration = Duration::from_secs(1);

/// Writes the plugin's file now. Main thread only (see the module doc).
/// Errors are logged, never returned: a save must not stop anything.
pub(crate) fn save(app: &AppHandle, why: &str) {
    if let Err(error) = app.save_window_state(flags()) {
        eprintln!("window state not saved ({why}): {error}");
    }
}

/// `save` from any thread: runs it on the main thread and waits for it, at
/// most a couple of seconds. For the update install, which exits the process
/// on Windows right after.
pub(crate) fn save_and_wait(app: &AppHandle, why: &'static str) {
    let (done, saved) = mpsc::channel();
    let handle = app.clone();
    let queued = app.run_on_main_thread(move || {
        save(&handle, why);
        let _ = done.send(());
    });
    if queued.is_ok() {
        let _ = saved.recv_timeout(Duration::from_secs(2));
    }
}

/// A resize or move of the main window: one write after the window has been
/// still for `QUIET`, whatever the number of events before that. Called from
/// the window event handler (main thread).
pub(crate) fn settle(window: &Window) {
    if !SETTLE.touch(Instant::now()) {
        // A thread is already waiting; it saw the new time.
        return;
    }
    let window = window.clone();
    std::thread::spawn(move || {
        while let Some(wait) = SETTLE.remaining(Instant::now()) {
            std::thread::sleep(wait);
        }
        let main = window.clone();
        let _ = window.run_on_main_thread(move || {
            // Minimized geometry is not worth a write (the plugin skips it too).
            if main.is_minimized().unwrap_or_default() {
                return;
            }
            save(main.app_handle(), "resize");
        });
    });
}

static SETTLE: Settle = Settle::new(QUIET);

/// The debounce behind `settle`, with the clock injected so it can be tested.
/// One waiting thread at a time: `touch` tells the caller whether to start
/// one, and `remaining` tells that thread how much longer to sleep.
pub(crate) struct Settle {
    quiet: Duration,
    inner: Mutex<Inner>,
}

struct Inner {
    /// The last event, or none since the last write.
    last: Option<Instant>,
    /// A thread is waiting for the window to settle.
    waiting: bool,
}

impl Settle {
    pub(crate) const fn new(quiet: Duration) -> Self {
        Settle {
            quiet,
            inner: Mutex::new(Inner {
                last: None,
                waiting: false,
            }),
        }
    }

    /// An event at `now`. True when no thread is waiting yet, so the caller
    /// has to start one; false when the waiting thread will see this event.
    pub(crate) fn touch(&self, now: Instant) -> bool {
        let mut inner = self.lock();
        inner.last = Some(now);
        !std::mem::replace(&mut inner.waiting, true)
    }

    /// Asked by the waiting thread at `now`. `Some(d)`: the window moved less
    /// than `quiet` ago, sleep `d` more and ask again. `None`: it has been
    /// still long enough, write now; the next event starts a new thread.
    pub(crate) fn remaining(&self, now: Instant) -> Option<Duration> {
        let mut inner = self.lock();
        let elapsed = inner
            .last
            .map(|last| now.saturating_duration_since(last))
            .unwrap_or(self.quiet);
        if elapsed < self.quiet {
            return Some(self.quiet - elapsed);
        }
        inner.last = None;
        inner.waiting = false;
        None
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    #[test]
    fn the_plugin_restores_geometry_but_not_decorations_or_visibility() {
        let flags = flags();
        assert!(flags.contains(StateFlags::SIZE));
        assert!(flags.contains(StateFlags::POSITION));
        assert!(flags.contains(StateFlags::MAXIMIZED));
        assert!(!flags.contains(StateFlags::DECORATIONS));
        assert!(!flags.contains(StateFlags::VISIBLE));
    }

    #[test]
    fn the_first_event_starts_the_wait_and_later_ones_join_it() {
        let settle = Settle::new(ms(1000));
        let t0 = Instant::now();
        assert!(settle.touch(t0));
        assert!(!settle.touch(t0 + ms(100)));
        assert!(!settle.touch(t0 + ms(900)));
    }

    #[test]
    fn the_write_is_due_once_the_window_has_been_still_for_the_quiet_time() {
        let settle = Settle::new(ms(1000));
        let t0 = Instant::now();
        settle.touch(t0);
        assert_eq!(settle.remaining(t0), Some(ms(1000)));
        assert_eq!(settle.remaining(t0 + ms(400)), Some(ms(600)));
        assert_eq!(settle.remaining(t0 + ms(1000)), None);
        // After the write the next event starts a new wait.
        assert!(settle.touch(t0 + ms(5000)));
    }

    #[test]
    fn an_event_during_the_wait_pushes_the_write_back() {
        let settle = Settle::new(ms(1000));
        let t0 = Instant::now();
        settle.touch(t0);
        settle.touch(t0 + ms(600));
        assert_eq!(settle.remaining(t0 + ms(1000)), Some(ms(600)));
        assert_eq!(settle.remaining(t0 + ms(1599)), Some(ms(1)));
        assert_eq!(settle.remaining(t0 + ms(1600)), None);
    }

    #[test]
    fn nothing_is_due_without_an_event() {
        let settle = Settle::new(ms(1000));
        assert_eq!(settle.remaining(Instant::now()), None);
        // And a thread that asks after the write ends at once.
        let t0 = Instant::now();
        settle.touch(t0);
        assert_eq!(settle.remaining(t0 + ms(1000)), None);
        assert_eq!(settle.remaining(t0 + ms(1001)), None);
    }
}
