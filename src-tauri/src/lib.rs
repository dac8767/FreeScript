use std::sync::Mutex;
use percent_encoding::percent_decode_str;
use tauri::{Emitter, Manager};
#[cfg(desktop)]
use tauri::menu::{Menu, Submenu, PredefinedMenuItem};

// ── Android content URI reading (JNI) ────────────────────────────────────
// On Android, files opened via intents use content:// URIs. These cannot be
// read with std::fs — we must go through Android's ContentResolver via JNI.

#[derive(serde::Serialize)]
struct ContentUriResult {
    content: String,
    filename: String,
}

#[tauri::command]
fn read_content_uri(uri: String) -> Result<ContentUriResult, String> {
    #[cfg(target_os = "android")]
    {
        android_read_content_uri(&uri)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = uri;
        Err("Content URI reading is only supported on Android".to_string())
    }
}

#[cfg(target_os = "android")]
fn android_read_content_uri(uri_str: &str) -> Result<ContentUriResult, String> {
    use jni::objects::{JObject, JString, JValue};
    use jni::JavaVM;

    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("Failed to get JVM: {}", e))?;
    let mut env = vm.attach_current_thread()
        .map_err(|e| format!("Failed to attach JNI thread: {}", e))?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // Parse URI string → android.net.Uri
    let uri_jstr = env.new_string(uri_str)
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let uri_obj = env.call_static_method(
        "android/net/Uri", "parse",
        "(Ljava/lang/String;)Landroid/net/Uri;",
        &[JValue::Object(&JObject::from(uri_jstr))],
    ).map_err(|e| format!("Uri.parse: {}", e))?
     .l().map_err(|e| format!("Uri.parse cast: {}", e))?;

    // Get ContentResolver
    let resolver = env.call_method(
        &activity, "getContentResolver",
        "()Landroid/content/ContentResolver;", &[],
    ).map_err(|e| format!("getContentResolver: {}", e))?
     .l().map_err(|e| format!("resolver cast: {}", e))?;

    // ── Query display name via Cursor ────────────────────────────────
    let mut filename = android_query_display_name(&mut env, &resolver, &uri_obj)
        .unwrap_or_else(|| extract_filename_from_uri(uri_str));

    // If display name has no file extension, query MIME type and append one.
    // Some Android content providers return display names without extensions.
    if !filename.contains('.') {
        if let Some(ext) = android_query_mime_extension(&mut env, &resolver, &uri_obj) {
            filename = format!("{}.{}", filename, ext);
            eprintln!("[content-uri] Added extension from MIME: {}", filename);
        }
    }

    // ── Read content via InputStream + Scanner ───────────────────────
    let input_stream = env.call_method(
        &resolver, "openInputStream",
        "(Landroid/net/Uri;)Ljava/io/InputStream;",
        &[JValue::Object(&uri_obj)],
    ).map_err(|e| format!("openInputStream: {}", e))?
     .l().map_err(|e| format!("openInputStream cast: {}", e))?;

    if input_stream.is_null() {
        return Err("ContentResolver.openInputStream returned null".to_string());
    }

    // Scanner(inputStream).useDelimiter("\\A").next() reads the entire stream
    let scanner = env.new_object(
        "java/util/Scanner",
        "(Ljava/io/InputStream;)V",
        &[JValue::Object(&input_stream)],
    ).map_err(|e| format!("new Scanner: {}", e))?;

    let delim = env.new_string("\\A")
        .map_err(|e| format!("delim string: {}", e))?;
    let _ = env.call_method(
        &scanner, "useDelimiter",
        "(Ljava/lang/String;)Ljava/util/Scanner;",
        &[JValue::Object(&JObject::from(delim))],
    ).map_err(|e| format!("useDelimiter: {}", e))?;

    let has_next = env.call_method(&scanner, "hasNext", "()Z", &[])
        .map_err(|e| format!("hasNext: {}", e))?
        .z().map_err(|e| format!("hasNext cast: {}", e))?;

    let content = if has_next {
        let result_obj = env.call_method(&scanner, "next", "()Ljava/lang/String;", &[])
            .map_err(|e| format!("next: {}", e))?
            .l().map_err(|e| format!("next cast: {}", e))?;
        let jstr: JString = result_obj.into();
        let java_str = env.get_string(&jstr)
            .map_err(|e| format!("get_string: {}", e))?;
        java_str.to_string_lossy().into_owned()
    } else {
        String::new()
    };

    let _ = env.call_method(&scanner, "close", "()V", &[]);

    eprintln!("[content-uri] Read {} chars, filename: {}", content.len(), filename);
    Ok(ContentUriResult { content, filename })
}

#[cfg(target_os = "android")]
fn android_query_display_name(
    env: &mut jni::JNIEnv,
    resolver: &jni::objects::JObject,
    uri: &jni::objects::JObject,
) -> Option<String> {
    use jni::objects::{JObject, JValue};

    // Create projection array: ["_display_name"]
    let col_name = env.new_string("_display_name").ok()?;
    let string_class = env.find_class("java/lang/String").ok()?;
    let projection = env.new_object_array(1, &string_class, &JObject::from(col_name)).ok()?;

    // query(uri, projection, null, null, null)
    let cursor = env.call_method(
        resolver, "query",
        "(Landroid/net/Uri;[Ljava/lang/String;Ljava/lang/String;[Ljava/lang/String;Ljava/lang/String;)Landroid/database/Cursor;",
        &[
            JValue::Object(uri),
            JValue::Object(&JObject::from(projection)),
            JValue::Object(&JObject::null()),
            JValue::Object(&JObject::null()),
            JValue::Object(&JObject::null()),
        ],
    ).ok()?.l().ok()?;

    if cursor.is_null() { return None; }

    let has_first = env.call_method(&cursor, "moveToFirst", "()Z", &[])
        .ok()?.z().ok()?;
    if !has_first {
        let _ = env.call_method(&cursor, "close", "()V", &[]);
        return None;
    }

    let name_obj = env.call_method(
        &cursor, "getString", "(I)Ljava/lang/String;",
        &[JValue::Int(0)],
    ).ok()?.l().ok()?;
    let _ = env.call_method(&cursor, "close", "()V", &[]);

    if name_obj.is_null() { return None; }

    let name_jstr: jni::objects::JString = name_obj.into();
    let java_str = env.get_string(&name_jstr).ok()?;
    let result = java_str.to_string_lossy().into_owned();
    if result.is_empty() { None } else { Some(result) }
}

/// Query the MIME type from ContentResolver and map it to a file extension.
/// Returns None if the MIME type can't be determined or doesn't map to a known extension.
#[cfg(target_os = "android")]
fn android_query_mime_extension(
    env: &mut jni::JNIEnv,
    resolver: &jni::objects::JObject,
    uri: &jni::objects::JObject,
) -> Option<String> {
    use jni::objects::{JObject, JValue};

    // resolver.getType(uri) → String (MIME type)
    let mime_obj = env.call_method(
        resolver, "getType",
        "(Landroid/net/Uri;)Ljava/lang/String;",
        &[JValue::Object(uri)],
    ).ok()?.l().ok()?;

    if mime_obj.is_null() { return None; }

    let jstr: jni::objects::JString = mime_obj.into();
    let mime = env.get_string(&jstr).ok()?.to_string_lossy().into_owned();
    eprintln!("[content-uri] MIME type: {}", mime);

    // Map common MIME types to file extensions
    match mime.as_str() {
        "application/xml" | "text/xml" => Some("fdx".to_string()),
        "application/json" => Some("odraft".to_string()),
        "text/plain" => Some("txt".to_string()),
        "text/fountain" => Some("fountain".to_string()),
        "application/pdf" => Some("pdf".to_string()),
        _ => {
            // Try the sub-type as extension (e.g. "application/fdx" → "fdx")
            mime.rsplit('/').next().map(|s| s.to_string())
        }
    }
}

/// Read the data URI from the Android Activity's launching intent.
/// Called during setup to detect file-association cold starts on Android.
#[cfg(target_os = "android")]
fn android_get_intent_data() -> Option<String> {
    use jni::objects::JObject;
    use jni::JavaVM;

    // ndk_context::android_context() panics with "android context was not
    // initialized" when called before tao's Android glue has registered the
    // JNI VM. That race shows up on cold start under some NDK/Tauri builds
    // and brings the whole app down. Treat a missing context as "no pending
    // file" — file-association handling is opportunistic.
    let ctx = std::panic::catch_unwind(|| ndk_context::android_context()).ok()?;
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // activity.getIntent()
    let intent = env.call_method(&activity, "getIntent", "()Landroid/content/Intent;", &[])
        .ok()?.l().ok()?;
    if intent.is_null() { return None; }

    // intent.getData()
    let data = env.call_method(&intent, "getData", "()Landroid/net/Uri;", &[])
        .ok()?.l().ok()?;
    if data.is_null() { return None; }

    // uri.toString()
    let uri_obj = env.call_method(&data, "toString", "()Ljava/lang/String;", &[])
        .ok()?.l().ok()?;
    if uri_obj.is_null() { return None; }

    let jstr: jni::objects::JString = uri_obj.into();
    let java_str = env.get_string(&jstr).ok()?;
    let uri_string = java_str.to_string_lossy().into_owned();

    if uri_string.is_empty() { return None; }
    eprintln!("[file-assoc] Android intent data URI: {}", uri_string);
    Some(uri_string)
}

/// Extract a filename from a content:// URI string as fallback.
#[cfg(target_os = "android")]
fn extract_filename_from_uri(uri: &str) -> String {
    // Try to get the last path segment that looks like a filename
    if let Some(path) = uri.split('?').next() {
        if let Some(segment) = path.rsplit('/').next() {
            let decoded = percent_decode_str(segment).decode_utf8_lossy().to_string();
            if decoded.contains('.') {
                return decoded;
            }
        }
    }
    "Untitled.fdx".to_string()
}

// ── Android share sheet ──────────────────────────────────────────────────
// On Android, the Tauri save dialog doesn't work reliably (similar to iOS).
// Instead, we write to the cache directory and present an Android share
// intent so the user can save to Files, share via any app, etc.

/// Android export: write file to cache, then present a "Save As" document picker
/// via ACTION_CREATE_DOCUMENT.  The user picks a location and Android copies the
/// content from our temp file to the chosen URI via ContentResolver.
///
/// Falls back to ACTION_SEND share sheet if CREATE_DOCUMENT fails (e.g. no
/// document provider is available on the device).
#[cfg(target_os = "android")]
fn android_share_file(file_path: &str, mime_type: &str) -> Result<(), String> {
    use jni::objects::{JObject, JValue};
    use jni::JavaVM;

    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("Failed to get JVM: {}", e))?;
    let mut env = vm.attach_current_thread()
        .map_err(|e| format!("Failed to attach JNI thread: {}", e))?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // Store the temp file path so onActivityResult can copy it to the user's chosen location
    let path_jstr = env.new_string(file_path)
        .map_err(|e| format!("JNI new_string: {}", e))?;
    env.call_static_method(
        "com/proteus/opendraft/MainActivity",
        "setExportSourcePath",
        "(Ljava/lang/String;)V",
        &[JValue::Object(&JObject::from(path_jstr))],
    ).map_err(|e| format!("setExportSourcePath: {}", e))?;

    // Extract filename from path
    let filename = file_path.rsplit('/').next().unwrap_or("export");

    // Create Intent(ACTION_CREATE_DOCUMENT) — Android's native "Save As" dialog
    let action_str = env.new_string("android.intent.action.CREATE_DOCUMENT")
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let intent = env.new_object("android/content/Intent", "(Ljava/lang/String;)V",
        &[JValue::Object(&JObject::from(action_str))])
        .map_err(|e| format!("new Intent: {}", e))?;

    // intent.addCategory(CATEGORY_OPENABLE)
    let cat_str = env.new_string("android.intent.category.OPENABLE")
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let _ = env.call_method(&intent, "addCategory",
        "(Ljava/lang/String;)Landroid/content/Intent;",
        &[JValue::Object(&JObject::from(cat_str))])
        .map_err(|e| format!("addCategory: {}", e))?;

    // intent.setType(mimeType)
    let mime = env.new_string(mime_type)
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let _ = env.call_method(&intent, "setType",
        "(Ljava/lang/String;)Landroid/content/Intent;",
        &[JValue::Object(&JObject::from(mime))])
        .map_err(|e| format!("setType: {}", e))?;

    // intent.putExtra(EXTRA_TITLE, filename) — suggested filename
    let extra_title = env.new_string("android.intent.extra.TITLE")
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let filename_jstr = env.new_string(filename)
        .map_err(|e| format!("JNI new_string: {}", e))?;
    let _ = env.call_method(&intent, "putExtra",
        "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;",
        &[
            JValue::Object(&JObject::from(extra_title)),
            JValue::Object(&JObject::from(filename_jstr)),
        ])
        .map_err(|e| format!("putExtra TITLE: {}", e))?;

    // activity.startActivityForResult(intent, EXPORT_FILE_REQUEST=43)
    env.call_method(&activity, "startActivityForResult",
        "(Landroid/content/Intent;I)V",
        &[JValue::Object(&intent), JValue::Int(43)])
        .map_err(|e| format!("startActivityForResult: {}", e))?;

    eprintln!("[export] Launched save-as picker for {}", filename);
    Ok(())
}

#[tauri::command]
fn android_save_and_share(filename: String, contents: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let cache_dir = std::env::temp_dir();
        let path = cache_dir.join(&filename);
        std::fs::write(&path, &contents)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        // Use application/octet-stream so Android's save-as dialog
        // preserves the exact filename without appending an extension
        android_share_file(&path.to_string_lossy(), "application/octet-stream")
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (filename, contents);
        Err("This command is only available on Android".to_string())
    }
}

#[tauri::command]
fn android_save_and_share_binary(filename: String, contents: Vec<u8>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let cache_dir = std::env::temp_dir();
        let path = cache_dir.join(&filename);
        std::fs::write(&path, &contents)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        let mime = if filename.ends_with(".pdf") { "application/pdf" } else { "application/octet-stream" };
        android_share_file(&path.to_string_lossy(), mime)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (filename, contents);
        Err("This command is only available on Android".to_string())
    }
}

// ── Android native file picker ──────────────────────────────────────────
// Launches ACTION_OPEN_DOCUMENT intent so the user can pick a file.
// The result is captured by MainActivity.onActivityResult() and stored in
// a static companion field, then retrieved by android_get_picked_file().

#[tauri::command]
fn android_pick_file() -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        use jni::objects::{JObject, JValue};
        use jni::JavaVM;

        let ctx = ndk_context::android_context();
        let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }
            .map_err(|e| format!("Failed to get JVM: {}", e))?;
        let mut env = vm.attach_current_thread()
            .map_err(|e| format!("Failed to attach JNI thread: {}", e))?;
        let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

        // Clear any previous picked file URI
        let null_obj = JObject::null();
        let _ = env.call_static_method(
            "com/proteus/opendraft/MainActivity",
            "setPickedFileUri",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&null_obj)],
        );

        // Create Intent(ACTION_OPEN_DOCUMENT)
        let action_str = env.new_string("android.intent.action.OPEN_DOCUMENT")
            .map_err(|e| format!("JNI new_string: {}", e))?;
        let intent = env.new_object(
            "android/content/Intent",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&JObject::from(action_str))],
        ).map_err(|e| format!("new Intent: {}", e))?;

        // intent.addCategory(CATEGORY_OPENABLE)
        let cat_str = env.new_string("android.intent.category.OPENABLE")
            .map_err(|e| format!("JNI new_string: {}", e))?;
        let _ = env.call_method(
            &intent, "addCategory",
            "(Ljava/lang/String;)Landroid/content/Intent;",
            &[JValue::Object(&JObject::from(cat_str))],
        ).map_err(|e| format!("addCategory: {}", e))?;

        // intent.setType("*/*") — accept all file types
        let mime_str = env.new_string("*/*")
            .map_err(|e| format!("JNI new_string: {}", e))?;
        let _ = env.call_method(
            &intent, "setType",
            "(Ljava/lang/String;)Landroid/content/Intent;",
            &[JValue::Object(&JObject::from(mime_str))],
        ).map_err(|e| format!("setType: {}", e))?;

        // activity.startActivityForResult(intent, PICK_FILE_REQUEST=42)
        env.call_method(
            &activity, "startActivityForResult",
            "(Landroid/content/Intent;I)V",
            &[JValue::Object(&intent), JValue::Int(42)],
        ).map_err(|e| format!("startActivityForResult: {}", e))?;

        eprintln!("[file-picker] Launched document picker");
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Err("This command is only available on Android".to_string())
    }
}

/// Read and clear the picked file URI from the Activity's companion object.
/// Returns the content URI string, empty string if cancelled, or None if
/// the picker hasn't returned yet.
#[tauri::command]
fn android_get_picked_file() -> Option<String> {
    #[cfg(target_os = "android")]
    {
        android_read_and_clear_companion_field("getPickedFileUri", "setPickedFileUri")
    }
    #[cfg(not(target_os = "android"))]
    {
        None
    }
}

/// Check for a new intent URI from a warm-start "Open with" action.
/// Reads and clears newIntentUri from the Activity companion object,
/// and updates the PendingFile state so get_opened_file stays in sync.
#[tauri::command]
fn android_check_new_intent(state: tauri::State<PendingFile>) -> Option<String> {
    #[cfg(target_os = "android")]
    {
        let uri = android_read_and_clear_companion_field("getNewIntentUri", "setNewIntentUri");
        if let Some(ref u) = uri {
            eprintln!("[file-assoc] New intent detected: {}", u);
            // Update PendingFile so get_opened_file returns this URI
            *state.0.lock().unwrap() = Some(u.clone());
        }
        uri
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        None
    }
}

/// Helper: read a String? from a static getter on MainActivity and clear it via the setter.
#[cfg(target_os = "android")]
fn android_read_and_clear_companion_field(getter: &str, setter: &str) -> Option<String> {
    use jni::objects::{JObject, JString, JValue};
    use jni::JavaVM;

    let ctx = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;

    let result = env.call_static_method(
        "com/proteus/opendraft/MainActivity",
        getter,
        "()Ljava/lang/String;",
        &[],
    ).ok()?.l().ok()?;

    if result.is_null() {
        return None;
    }

    let jstr: JString = result.into();
    let value = env.get_string(&jstr).ok()?.to_string_lossy().into_owned();

    // Clear the field
    let null_obj = JObject::null();
    let _ = env.call_static_method(
        "com/proteus/opendraft/MainActivity",
        setter,
        "(Ljava/lang/String;)V",
        &[JValue::Object(&null_obj)],
    );

    // Return Some even for empty string (signals cancellation for file picker)
    Some(value)
}

// ── iOS file helpers (Objective-C FFI) ────────────────────────────────────
// On iOS, files from the Files app or document picker require security-scoped
// URL access. These functions are defined in FileHelpers.m and linked into
// the iOS binary automatically via XcodeGen.

#[cfg(target_os = "ios")]
extern "C" {
    fn ios_present_share_sheet(file_path: *const std::ffi::c_char);
    fn ios_read_text_file(path: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    fn ios_free_string(ptr: *mut std::ffi::c_char);
    fn ios_copy_file_scoped(src: *const std::ffi::c_char, dst: *const std::ffi::c_char) -> i32;
}

// ── iOS export commands ──────────────────────────────────────────────────
// On iOS, the native save dialog doesn't work reliably (files end up 0 bytes).
// Instead, we write to a temp file and present the iOS share sheet so the user
// can save to Files, AirDrop, etc.

#[tauri::command]
fn ios_save_and_share(filename: String, contents: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let temp_dir = std::env::temp_dir();
        let path = temp_dir.join(&filename);
        std::fs::write(&path, &contents)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        let c_path = std::ffi::CString::new(path.to_string_lossy().as_bytes())
            .map_err(|e| format!("Invalid path: {}", e))?;
        unsafe { ios_present_share_sheet(c_path.as_ptr()); }
        Ok(())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (filename, contents);
        Err("This command is only available on iOS".to_string())
    }
}

#[tauri::command]
fn ios_save_and_share_binary(filename: String, contents: Vec<u8>) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let temp_dir = std::env::temp_dir();
        let path = temp_dir.join(&filename);
        std::fs::write(&path, &contents)
            .map_err(|e| format!("Failed to write temp file: {}", e))?;
        let c_path = std::ffi::CString::new(path.to_string_lossy().as_bytes())
            .map_err(|e| format!("Invalid path: {}", e))?;
        unsafe { ios_present_share_sheet(c_path.as_ptr()); }
        Ok(())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (filename, contents);
        Err("This command is only available on iOS".to_string())
    }
}

// ── Pending file state ────────────────────────────────────────────────────
// Stores the file path when the OS opens a script file with ScriptCraft.
// The frontend retrieves it on startup via the get_opened_file command.
struct PendingFile(Mutex<Option<String>>);

/// Extensions that ScriptCraft can open via file association.
// v7.18: `json` is here for the LEGACY `<title>.odraft.json` copies the Save
// As mirror wrote between v1.16 and v7.17 — their last extension is `json`,
// so "Open With ▸ ScriptCraft" was refused on the very files the feature
// created. A .json that is not a script gets a friendly parse error, not a
// crash. New copies are written as .odraft.
// v7.21: "script" is the current name; "odraft" is what the app wrote
// through v7.20 and "json" the v1.16-v7.17 folder copies. A file this app
// wrote is a file this app opens — none of these ever expire.
const OPENABLE_EXTENSIONS: &[&str] = &["fdx", "fountain", "script", "odraft", "txt", "json"];

fn is_openable_file(path: &str) -> bool {
    let ext = path.rsplit('.').next().unwrap_or("");
    OPENABLE_EXTENSIONS.contains(&ext.to_lowercase().as_str())
}

#[tauri::command]
fn get_opened_file(state: tauri::State<PendingFile>) -> Option<String> {
    state.0.lock().unwrap().clone()
}

// ── File I/O commands ──────────────────────────────────────────────────────
// These bypass the fs plugin scope so the user can save/open files anywhere
// via the native dialog.

/// v7.87 (security review D3) — write a file the way that cannot lose the old
/// one. `std::fs::write` opens the target with O_TRUNC, destroying the existing
/// bytes the instant it starts; a failure partway (disk full, a revoked
/// permission, a cloud-sync lock, power loss) then leaves the file EMPTY. This
/// writes a sibling temp file, flushes it to disk, and renames it over the
/// target — an atomic replace on the same filesystem, so the target is only
/// ever the complete old file or the complete new one.
static ATOMIC_SAVE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn atomic_write(path: &str, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let target = std::path::Path::new(path);
    let parent = match target.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.to_path_buf(),
        _ => std::path::PathBuf::from("."),
    };
    // v6.42/v7.17: missing parent folders are created (Auto Saves subfolder,
    // mirrored copies, screenshots pick a folder that may not exist yet).
    std::fs::create_dir_all(&parent)
        .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;

    // A sibling temp file, so the rename stays on the same filesystem (a
    // cross-device rename is not atomic and would fail). The seq + pid keep
    // concurrent saves (autosave overlapping a manual save) from colliding.
    let seq = ATOMIC_SAVE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let stem = target.file_name().and_then(|n| n.to_str()).unwrap_or("scriptcraft");
    let tmp = parent.join(format!(".{}.tmp{}-{}", stem, std::process::id(), seq));

    let written = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?; // durability: the bytes are on disk before the rename
        Ok(())
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Failed to write {}: {}", path, e));
    }

    // std::fs::rename replaces an existing target atomically on Unix, and on
    // Windows (MoveFileExW with REPLACE_EXISTING). On failure the original is
    // untouched and we clean up the temp.
    std::fs::rename(&tmp, target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Failed to save {}: {}", path, e)
    })
}

#[tauri::command]
fn save_text_to_path(path: String, contents: String) -> Result<(), String> {
    atomic_write(&path, contents.as_bytes())
}

#[tauri::command]
fn save_binary_to_path(path: String, contents: Vec<u8>) -> Result<(), String> {
    atomic_write(&path, &contents)
}

/// v7.17 — PROVE a chosen folder is writable, now, while the user is looking
/// at it (v1.18's reason, unchanged: the failure used to surface later, at
/// save time, as a frightening "could not save your changes").
///
/// It lives in Rust because the probe is the ONLY thing Save As needed the
/// plugin's `remove` permission for, and the fs capability is now narrowed to
/// $APPDATA — a folder the user picked is, by definition, outside it. Writing
/// and deleting the probe here keeps the check honest without handing the
/// webview a delete-anything permission.
///
/// v1.20's lesson is kept: the probe is NOT a dotfile. Under the plugin, glob
/// scopes did not match leading-dot names, so the writability check was the
/// one thing that could not be written and it reported that as the folder
/// being unwritable — the check invented the failure it was looking for.
#[tauri::command]
fn check_folder_writable(folder: String) -> Result<(), String> {
    let dir = std::path::Path::new(&folder);
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
    let probe = dir.join("scriptcraft-write-test.tmp");
    std::fs::write(&probe, b"")
        .map_err(|e| format!("Failed to write {}: {}", probe.display(), e))?;
    // The write is what mattered; a leftover probe is untidy, not a failure.
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// v7.87 (security review D14) — a sanity ceiling on a single file read.
/// Screenplays are tiny; this only stops a pathological or wrong file from
/// being pulled fully into memory and then again across the IPC boundary. A
/// metadata error is ignored (the read itself will report the real problem;
/// on iOS a security-scoped file may have no readable metadata yet).
const MAX_READ_BYTES: u64 = 256 * 1024 * 1024;

fn check_read_size(path: &str) -> Result<(), String> {
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() > MAX_READ_BYTES {
            return Err(format!(
                "This file is too large to open ({} MB).",
                meta.len() / (1024 * 1024)
            ));
        }
    }
    Ok(())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    check_read_size(&path)?;
    #[cfg(not(target_os = "ios"))]
    {
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
    }
    #[cfg(target_os = "ios")]
    {
        // Try standard read first (works for files already in the sandbox)
        if let Ok(content) = std::fs::read_to_string(&path) {
            return Ok(content);
        }
        // Fallback: try reading via Foundation APIs with security-scoped access
        eprintln!("[read_text_file] std::fs failed, trying iOS security-scoped read: {}", path);
        let c_path = std::ffi::CString::new(path.as_bytes())
            .map_err(|_| format!("Invalid path: {}", path))?;
        let result = unsafe { ios_read_text_file(c_path.as_ptr()) };
        if result.is_null() {
            return Err(format!("Failed to read {}: Operation not permitted", path));
        }
        let content = unsafe { std::ffi::CStr::from_ptr(result) }
            .to_string_lossy()
            .into_owned();
        unsafe { ios_free_string(result); }
        Ok(content)
    }
}

#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    check_read_size(&path)?;
    std::fs::read(&path).map_err(|e| format!("Failed to read {}: {}", path, e))
}

// ── Generic HTTP fetch command ────────────────────────────────────────────
// Makes HTTP requests from Rust, bypassing WebView mixed-content restrictions.
// The Tauri WebView loads from https://tauri.localhost, so browser fetch() to
// plain http:// addresses (collab server, local backends) is blocked.

#[derive(serde::Serialize)]
struct HttpFetchResponse {
    status: u16,
    body: String,
}

#[tauri::command]
async fn http_fetch(
    url: String,
    method: Option<String>,
    body: Option<String>,
    content_type: Option<String>,
    authorization: Option<String>,
) -> Result<HttpFetchResponse, String> {
    let method_str = method.as_deref().unwrap_or("GET");
    eprintln!("[http_fetch] {} {}", method_str, url);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| {
            eprintln!("[http_fetch] Client build error: {}", e);
            format!("HTTP client error: {}", e)
        })?;

    let req_method = method_str.parse::<reqwest::Method>()
        .map_err(|e| format!("Invalid method '{}': {}", method_str, e))?;

    let mut req = client.request(req_method, &url);

    if let Some(ct) = &content_type {
        req = req.header("Content-Type", ct.as_str());
    }

    if let Some(auth) = &authorization {
        req = req.header("Authorization", auth.as_str());
    }

    if let Some(b) = &body {
        req = req.body(b.clone());
    }

    let resp = req.send().await
        .map_err(|e| {
            eprintln!("[http_fetch] {} {} → FAILED: {}", method_str, url, e);
            format!("Request to {} failed: {}", url, e)
        })?;

    let status = resp.status().as_u16();
    let body_text = resp.text().await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    eprintln!("[http_fetch] {} {} → {} ({} bytes)", method_str, url, status, body_text.len());

    Ok(HttpFetchResponse {
        status,
        body: body_text,
    })
}

// ── Link preview command ───────────────────────────────────────────────────
// Fetches a URL and extracts Open Graph metadata. Used by the editor's link
// preview feature. Runs in Rust to avoid CORS issues that browser fetch has.

#[derive(serde::Serialize)]
struct LinkPreview {
    url: String,
    title: String,
    description: String,
    image: String,
    site_name: String,
}

#[tauri::command]
async fn fetch_link_preview(url: String) -> Result<LinkPreview, String> {
    let html = fetch_url_body(&url).await.map_err(|e| format!("Failed to fetch {}: {}", url, e))?;

    let title = extract_og_tag(&html, "og:title")
        .or_else(|| extract_html_title(&html))
        .unwrap_or_default();
    let description = extract_og_tag(&html, "og:description")
        .or_else(|| extract_meta_description(&html))
        .unwrap_or_default();
    let image = extract_og_tag(&html, "og:image").unwrap_or_default();
    let site_name = extract_og_tag(&html, "og:site_name").unwrap_or_default();

    Ok(LinkPreview { url, title, description, image, site_name })
}

/// v7.85 (security review D4) — an address a link preview must never fetch:
/// loopback, private, link-local, unique-local, CGNAT, the unspecified and
/// broadcast addresses. A preview URL can arrive inside an OPENED file, so
/// without this the act of opening a stranger's script makes this machine GET
/// `http://localhost:…`, `http://169.254.169.254/…` (cloud metadata) or an
/// intranet host and echo the response back into the card.
fn is_blocked_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.is_documentation()
                // 100.64.0.0/10 carrier-grade NAT
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 0x40)
        }
        std::net::IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() {
                return true;
            }
            // An IPv4-mapped v6 address is just a v4 address wearing a hat.
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(std::net::IpAddr::V4(v4));
            }
            let seg0 = v6.segments()[0];
            (seg0 & 0xfe00) == 0xfc00   // fc00::/7 unique-local
                || (seg0 & 0xffc0) == 0xfe80 // fe80::/10 link-local
        }
    }
}

/// Resolve `host` off the async runtime and refuse it unless it resolves to at
/// least one address and EVERY address is public. Blocks the SSRF/beacon in
/// `fetch_url_body`. Note: this screens the hostname's current DNS answer; a
/// name that resolves public here and private on the real connection (DNS
/// rebinding) is the residual a desktop link-preview accepts.
async fn screen_host(host: &str, port: u16) -> Result<(), String> {
    let host_port = format!("{host}:{port}");
    let ips = tauri::async_runtime::spawn_blocking(move || {
        use std::net::ToSocketAddrs;
        host_port
            .to_socket_addrs()
            .map(|it| it.map(|s| s.ip()).collect::<Vec<std::net::IpAddr>>())
    })
    .await
    .map_err(|e| format!("resolve task failed: {e}"))?
    .map_err(|e| format!("could not resolve host: {e}"))?;

    if ips.is_empty() {
        return Err("host did not resolve".to_string());
    }
    if ips.into_iter().any(is_blocked_ip) {
        return Err("refusing to fetch a private, loopback, or link-local address".to_string());
    }
    Ok(())
}

/// Fetch URL body using reqwest (works on all platforms including iOS/Android).
/// Times out after 5 seconds.
///
/// v7.85 (security review D4): only http/https, the host is screened against
/// internal address ranges before the request, and redirects are capped and
/// refused when they point at a literal internal host — so a public URL cannot
/// bounce the fetch to `localhost` or the metadata endpoint.
async fn fetch_url_body(url: &str) -> Result<String, Box<dyn std::error::Error>> {
    let parsed = reqwest::Url::parse(url)?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("refusing to fetch non-http(s) scheme: {other}").into()),
    }
    let host = parsed.host_str().ok_or("url has no host")?;
    let port = parsed
        .port_or_known_default()
        .unwrap_or(if parsed.scheme() == "https" { 443 } else { 80 });
    screen_host(host, port).await?;

    // Cap redirects, and refuse any hop whose target is a literal internal host
    // (a public hostname that DNS-resolves internally is the rebinding residual
    // noted on screen_host).
    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.stop();
        }
        if let Some(h) = attempt.url().host_str() {
            let lower = h.to_ascii_lowercase();
            let internal = lower == "localhost"
                || lower
                    .parse::<std::net::IpAddr>()
                    .map(is_blocked_ip)
                    .unwrap_or(false);
            if internal {
                return attempt.error("refusing to follow a redirect to an internal host");
            }
        }
        attempt.follow()
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .user_agent("Mozilla/5.0 (compatible; ScriptCraft/1.0)")
        .redirect(redirect_policy)
        .build()?;

    let resp = client.get(url).send().await?;
    let body = resp.text().await?;
    Ok(body)
}

/// Extract an Open Graph meta tag value from HTML.
fn extract_og_tag(html: &str, property: &str) -> Option<String> {
    // Match: <meta property="og:title" content="...">
    // Also match: <meta content="..." property="og:title">
    let lower = html.to_lowercase();
    let prop_pattern = format!("property=\"{}\"", property);

    // Find the meta tag containing this property
    let mut search_from = 0;
    while let Some(meta_start) = lower[search_from..].find("<meta ") {
        let abs_start = search_from + meta_start;
        let tag_end = match lower[abs_start..].find('>') {
            Some(pos) => abs_start + pos,
            None => break,
        };
        let tag = &html[abs_start..=tag_end];
        let tag_lower = &lower[abs_start..=tag_end];

        if tag_lower.contains(&prop_pattern) {
            if let Some(content) = extract_attr(tag, "content") {
                return Some(decode_html_entities(&content));
            }
        }
        search_from = tag_end + 1;
    }
    None
}

/// Extract the <title> tag content.
fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?.checked_add(lower[lower.find("<title")?..].find('>')?)?;
    let content_start = start + 1;
    let end = lower[content_start..].find("</title>")?;
    let title = html[content_start..content_start + end].trim();
    if title.is_empty() { None } else { Some(decode_html_entities(title)) }
}

/// Extract <meta name="description" content="...">.
fn extract_meta_description(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let mut search_from = 0;
    while let Some(meta_start) = lower[search_from..].find("<meta ") {
        let abs_start = search_from + meta_start;
        let tag_end = match lower[abs_start..].find('>') {
            Some(pos) => abs_start + pos,
            None => break,
        };
        let tag = &html[abs_start..=tag_end];
        let tag_lower = &lower[abs_start..=tag_end];

        if tag_lower.contains("name=\"description\"") {
            if let Some(content) = extract_attr(tag, "content") {
                return Some(decode_html_entities(&content));
            }
        }
        search_from = tag_end + 1;
    }
    None
}

/// Extract an HTML attribute value (case-insensitive attribute name).
fn extract_attr(tag: &str, attr_name: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let pattern = format!("{}=\"", attr_name);
    let start = lower.find(&pattern)? + pattern.len();
    let end = lower[start..].find('"')? + start;
    Some(tag[start..end].to_string())
}

/// Decode common HTML entities.
fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

/// Guess MIME type from file extension.
fn guess_mime(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_lowercase()).as_deref() {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        Some("pdf") => "application/pdf",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("json") => "application/json",
        Some("txt") => "text/plain",
        _ => "application/octet-stream",
    }
}

// ── New window command (for multi-instance support) ──────────────────────
// Each WebviewWindow gets its own JS context, so editor state is independent.
use std::sync::atomic::{AtomicU32, AtomicBool, Ordering};
static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);
/// Set to true once the main window has finished loading.
/// Used to distinguish cold-start file opens (load into main window)
/// from warm-start file opens (open in a new window).
static APP_READY: AtomicBool = AtomicBool::new(false);

/// Update the native window title.
/// Called from the frontend whenever the document title changes.
/// (v5.21, Derek: "remove the window menu" — the Window-menu rebuild that
/// used to live here is gone. The JS menu sync had already dropped the
/// standalone Window menu in v4.28; this rebuild kept re-appending a fresh
/// one after every title change, which is why it kept coming back.)
#[tauri::command]
async fn set_window_title(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let display_title = if title.is_empty() { "ScriptCraft".to_string() } else { format!("{} — ScriptCraft", title) };
        window.set_title(&display_title).map_err(|e| format!("{}", e))?;
    }
    #[cfg(not(desktop))]
    { let _ = (window, title); }
    Ok(())
}

/// Which key in the update manifest's `platforms` map describes THIS machine.
///
/// v7.78. The frontend has to answer one question before it may offer an
/// "Install and Restart" button: does the published release actually carry an
/// artifact this computer can install? A button that offers to install a build
/// that does not exist for the machine it is running on is the silent no-op
/// this app treats as the cardinal sin, and the release matrix is genuinely
/// uneven — an Apple Silicon Mac and an Intel Mac are two different downloads.
///
/// It has to come from Rust. The webview cannot tell: WebKit reports "Intel
/// Mac OS X" in navigator.userAgent on Apple Silicon too, so asking the browser
/// gets a confident wrong answer rather than no answer.
///
/// The spelling is Tauri's, not Rust's — the manifest keys are `darwin-*`,
/// while std::env::consts::OS says "macos".
#[tauri::command]
fn updater_target() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    format!("{}-{}", os, std::env::consts::ARCH)
}

// v7.84 (security review D2) — the hand-rolled `open_url` command is GONE.
// On Windows it ran `cmd /C start "" <url>`, and `cmd` re-parses `& | ^`, so a
// space-free URL like `https://x/&calc.exe` in a note of an OPENED script
// executed a program on click — native code, no webview script needed, so the
// CSP could not touch it. External links now route through tauri-plugin-opener
// (already registered below and used by File ▸ Print via openPath). The plugin
// opens URLs through the OS shell API, not a re-parsed command line, and the
// `opener:allow-default-urls` capability scopes it to http/https/mailto/tel.
// One opener for the whole app — the duplicate shell-out is retired.

/// v6.36, Derek ("it opens it in a pdf view first. it should not do that"):
/// File ▸ Print runs the REAL macOS print dialog on the just-written export
/// PDF — PDFKit builds the print operation, the system panel comes straight
/// up, no viewer in between.
///
/// v6.37, Derek ("File > Print made the app crash") — the v6.36 shape had
/// two faults, both fixed here:
///  (1) the command was SYNC, and Tauri runs sync commands ON THE MAIN
///      THREAD — so rx.recv() blocked the very thread the print closure
///      was queued to run on. The command is async now (off-main).
///  (2) runOperation() spun an APP-MODAL nested run loop inside the event
///      loop callback. The panel now presents as a SHEET on the main
///      window — present-and-return, no nested modal loop.
/// Everything AppKit/PDFKit is additionally wrapped in
/// objc2::exception::catch, so a raised NSException reports back as an Err
/// (the frontend falls back to opening the file) instead of terminating
/// the process. Body verified against aarch64-apple-darwin with the pinned
/// objc2 crates (this sandbox cross-checks types; it cannot run it — the
/// exception-helper C shim compiles only on Derek's machine).
/// v6.43 — THE REMAINING CRASH (Derek: "File > Print still makes the app
/// crash", surviving v6.37's async/sheet/catch fix): the sheet variant of
/// NSPrintOperation presents ASYNCHRONOUSLY — `runOperationModalForWindow…`
/// schedules the sheet and returns at once. The closure then ended and
/// DROPPED the `Retained` operation, so the runloop presented a sheet for a
/// deallocated object: a use-after-free SIGSEGV that no ObjC exception catch
/// can intercept, before any dialog became visible. The operation (and its
/// document) now live in a main-thread slot until the NEXT print replaces
/// them — the classic keep-alive AppKit expects from this API.
#[cfg(target_os = "macos")]
thread_local! {
    static ACTIVE_PRINT: std::cell::RefCell<
        Option<(
            objc2::rc::Retained<objc2_app_kit::NSPrintOperation>,
            objc2::rc::Retained<objc2_pdf_kit::PDFDocument>,
        )>,
    > = const { std::cell::RefCell::new(None) };
}

/// v6.44 — crash breadcrumbs. Every print attempt rewrites
/// app-data/print/print-debug.log, one fsync'd line per step. A crash keeps
/// the file: its LAST line names the step that died, which pins the faulty
/// call without needing Console.app. (Four rounds in: this ends the
/// remote-diagnosis guessing for good.)
#[cfg(target_os = "macos")]
fn print_breadcrumb(dir: &std::path::Path, first: bool, msg: &str) {
    use std::io::Write;
    let p = dir.join("print-debug.log");
    let f = if first {
        std::fs::File::create(&p)
    } else {
        std::fs::OpenOptions::new().create(true).append(true).open(&p)
    };
    if let Ok(mut f) = f {
        let _ = writeln!(f, "{}", msg);
        let _ = f.sync_all();
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn print_pdf_dialog(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSPrintInfo, NSWindow};
    use objc2_foundation::{NSString, NSURL};
    use objc2_pdf_kit::{PDFDocument, PDFPrintScalingMode};

    // Print ONLY what this app just wrote: canonical path under
    // app-data/print (the asset handler's containment pattern).
    let canonical =
        std::fs::canonicalize(&path).map_err(|e| format!("cannot read {}: {}", path, e))?;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("print");
    let base = std::fs::canonicalize(&base).map_err(|e| e.to_string())?;
    if !canonical.starts_with(&base) {
        return Err("refusing to print outside the app's print folder".to_string());
    }

    let win_ptr = app
        .get_webview_window("main")
        .ok_or("no main window to print from")?
        .ns_window()
        .map_err(|e| e.to_string())? as usize;

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let path_str = canonical.to_string_lossy().into_owned();
    let crumb_dir = base.clone();
    print_breadcrumb(&crumb_dir, true, "start");
    app.run_on_main_thread(move || {
        print_breadcrumb(&crumb_dir, false, "main-thread");
        let result: Result<(), String> = objc2::exception::catch(move || {
            let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
            unsafe {
                let url = NSURL::fileURLWithPath(&NSString::from_str(&path_str));
                let doc = PDFDocument::initWithURL(PDFDocument::alloc(), &url)
                    .ok_or("could not open the PDF for printing")?;
                print_breadcrumb(&crumb_dir, false, "doc-loaded");
                /* v6.44 — the ONE call every crashing round shared (modal
                   v6.36, sheet v6.37, kept-alive sheet v6.43): creating the
                   operation with a NIL print info. The header marks the
                   parameter nullable, but every working PDFKit example
                   passes [NSPrintInfo sharedPrintInfo] — and a crash INSIDE
                   creation explains all three rounds failing identically,
                   before any dialog logic diverged. Pass the real thing. */
                let info = NSPrintInfo::sharedPrintInfo();
                print_breadcrumb(&crumb_dir, false, "printinfo");
                let op = doc
                    .printOperationForPrintInfo_scalingMode_autoRotate(
                        Some(&info),
                        PDFPrintScalingMode::PageScaleNone,
                        true,
                        mtm,
                    )
                    .ok_or("no print operation available")?;
                print_breadcrumb(&crumb_dir, false, "op-created");
                op.setShowsPrintPanel(true);
                op.setShowsProgressPanel(true);
                let win: &NSWindow = &*(win_ptr as *mut NSWindow);
                print_breadcrumb(&crumb_dir, false, "presenting-sheet");
                op.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                    win,
                    None,
                    None,
                    std::ptr::null_mut(),
                );
                print_breadcrumb(&crumb_dir, false, "sheet-scheduled");
                // Keep the operation + document alive PAST this closure —
                // the sheet only presents after we return (see the header
                // comment). Replaced on the next print; released then.
                ACTIVE_PRINT.with(|slot| *slot.borrow_mut() = Some((op, doc)));
                print_breadcrumb(&crumb_dir, false, "kept-alive");
                Ok(())
            }
        })
        .map_err(|e| format!("print raised an exception: {:?}", e))
        .and_then(|inner| inner);
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    // The sheet presents and returns; this resolves as it appears.
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(5))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("print dispatch failed: {}", e))?
}

/// Non-macOS: no native PDF print dialog here — the frontend falls back to
/// opening the file in the OS viewer.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn print_pdf_dialog(_path: String) -> Result<(), String> {
    Err("the native print dialog is macOS-only".to_string())
}

// (v5.21: rebuild_window_menu is GONE with the Window menu itself — it was
// re-appending a "Window" submenu to the JS-installed app menu, resurrecting
// a menu the frontend removed in v4.28.)

#[tauri::command]
async fn open_new_window(app: tauri::AppHandle) -> Result<(), String> {
    let count = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
    let label = format!("main-{}", count);
    // Use "/" so BrowserRouter matches the root route (not "/index.html")
    let url = tauri::WebviewUrl::App("/".into());
    let mut builder = tauri::WebviewWindowBuilder::new(&app, &label, url);
    // .title(), .inner_size(), .min_inner_size(), .resizable() are desktop-only
    #[cfg(desktop)]
    {
        builder = builder
            .title("ScriptCraft")
            .inner_size(1280.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .resizable(true)
            .maximized(true);
    }
    // v3.09: match the main window's overlay titlebar (the in-app Quick
    // Access Toolbar row draws the title; see TitleBar.tsx).
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }
    builder.build()
        .map_err(|e| format!("Failed to create window: {}", e))?;
    // (v5.21: no Window menu to refresh anymore.)
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // ── Plugins (available on all platforms) ────────────────────────
        .plugin(
            tauri_plugin_sql::Builder::default()
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // v6.33: opener — File ▸ Print writes the export PDF to app data and
        // opens it in the OS PDF viewer, one ⌘P from the real print dialog
        // (WKWebView has no in-webview road to printing a generated PDF).
        .plugin(tauri_plugin_opener::init())
        // ── Asset protocol: serve local files for convertFileSrc() URLs ──
        // (the updater/process plugins are registered further down — they are
        //  desktop-only and go on behind a cfg, see `builder` below)
        .register_uri_scheme_protocol("asset", |ctx, request| {
            let uri = request.uri();
            let raw_path = uri.path();

            // Build a Response without unwrapping — a panic here aborts the
            // whole process because [profile.release] panic = "abort".
            let build_response = |status: u16, mime: &str, body: Vec<u8>| {
                tauri::http::Response::builder()
                    .status(status)
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .body(body)
                    .unwrap_or_else(|_| {
                        tauri::http::Response::new(Vec::new())
                    })
            };

            /* v6.33, Derek ("the images are still broken in the asset
               manager"): convertFileSrc() percent-encodes the WHOLE absolute
               path as one segment, so uri.path() is "/%2FUsers%2F…" and
               decoding yields "//Users/…". trim_start_matches('/') strips
               EVERY leading slash, leaving a RELATIVE path that
               std::fs::read resolved against the process cwd — a packaged
               app launched from Finder (cwd "/") happens to survive that,
               but under `tauri dev` (cwd = src-tauri) every asset read
               404'd. Re-anchor the path as absolute; Windows drive paths
               ("C:/…") carry no leading slash. */
            let decoded = percent_decode_str(raw_path).decode_utf8_lossy();
            let trimmed = decoded.trim_start_matches('/');
            #[cfg(windows)]
            let file_path_str = trimmed.to_string();
            #[cfg(not(windows))]
            let file_path_str = format!("/{}", trimmed);

            // Serve ONLY files under the app data dir — every
            // convertFileSrc() consumer builds appDataDir paths (assets).
            // Canonicalize before the check so "../" cannot escape it.
            let canonical = match std::fs::canonicalize(&file_path_str) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("[asset] Failed to resolve {}: {}", file_path_str, e);
                    return build_response(404, "text/plain", Vec::new());
                }
            };
            let in_scope = ctx
                .app_handle()
                .path()
                .app_data_dir()
                .ok()
                .and_then(|b| std::fs::canonicalize(b).ok())
                .map_or(false, |b| canonical.starts_with(&b));
            if !in_scope {
                eprintln!("[asset] Refused out-of-scope path {}", file_path_str);
                return build_response(403, "text/plain", Vec::new());
            }
            match std::fs::read(&canonical) {
                Ok(data) => build_response(200, guess_mime(&canonical), data),
                Err(e) => {
                    eprintln!("[asset] Failed to read {}: {}", file_path_str, e);
                    build_response(404, "text/plain", Vec::new())
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            save_text_to_path,
            save_binary_to_path,
            check_folder_writable,
            read_text_file,
            read_binary_file,
            http_fetch,
            fetch_link_preview,
            get_opened_file,
            read_content_uri,
            ios_save_and_share,
            ios_save_and_share_binary,
            android_save_and_share,
            android_save_and_share_binary,
            android_pick_file,
            android_get_picked_file,
            android_check_new_intent,
            open_new_window,
            set_window_title,
            print_pdf_dialog,
            updater_target,
        ]);

        /* ── In-app updating (desktop only) ────────────────────────────
           v7.78. Both plugins are behind #[cfg(desktop)] because they are
           desktop-only crates — see the scoped dependency table in Cargo.toml.
           Registering them here rather than in the all-platforms chain above
           keeps that fact in one shape: the cfg on the dependency and the cfg
           on the registration say the same thing in the same place.

           The updater DOWNLOADS AND REPLACES THE BUNDLE; process supplies the
           restart afterwards, which the updater deliberately does not do. */
        #[cfg(desktop)]
        let builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());

        // ── Native menu (desktop only) ────────────────────────────────
        // macOS: App menu + Edit menu (Cmd+C/V/X/A/Z) + Window menu.
        //        The Edit menu is required for clipboard & undo shortcuts
        //        to reach the webview on macOS.
        // Windows/Linux: empty menu — no native menu bar shown.
        // Mobile (iOS/Android): no menu support — .menu() is not available.
        #[cfg(desktop)]
        let builder = builder.menu(|app_handle| {
            #[cfg(target_os = "macos")]
            {
                let app_submenu = Submenu::with_items(
                    app_handle,
                    "ScriptCraft",
                    true,
                    &[
                        &PredefinedMenuItem::about(app_handle, Some("About ScriptCraft"), None)?,
                        &PredefinedMenuItem::separator(app_handle)?,
                        &PredefinedMenuItem::services(app_handle, None)?,
                        &PredefinedMenuItem::separator(app_handle)?,
                        &PredefinedMenuItem::hide(app_handle, None)?,
                        &PredefinedMenuItem::hide_others(app_handle, None)?,
                        &PredefinedMenuItem::show_all(app_handle, None)?,
                        &PredefinedMenuItem::separator(app_handle)?,
                        &PredefinedMenuItem::quit(app_handle, None)?,
                    ],
                )?;
                let edit_submenu = Submenu::with_items(
                    app_handle,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app_handle, None)?,
                        &PredefinedMenuItem::redo(app_handle, None)?,
                        &PredefinedMenuItem::separator(app_handle)?,
                        &PredefinedMenuItem::cut(app_handle, None)?,
                        &PredefinedMenuItem::copy(app_handle, None)?,
                        &PredefinedMenuItem::paste(app_handle, None)?,
                        &PredefinedMenuItem::select_all(app_handle, None)?,
                    ],
                )?;
                // v5.21, Derek: no Window submenu — the JS menu sync dropped
                // it in v4.28 and the boot menu now matches (it only exists
                // until the frontend installs the full menu set anyway).
                Menu::with_items(app_handle, &[&app_submenu, &edit_submenu])
            }
            #[cfg(not(target_os = "macos"))]
            {
                Menu::new(app_handle)
            }
        });

    let builder = builder.setup(|app| {
            // Ensure user data directory exists
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");
            std::fs::create_dir_all(&app_data_dir).ok();

            eprintln!("ScriptCraft starting — local SQLite storage");
            eprintln!("Data dir: {}", app_data_dir.display());

            // ── Check for file association launch ──────────────────────────
            let mut pending: Option<String> = None;

            // Windows/Linux: check CLI args
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                let args: Vec<String> = std::env::args().collect();
                if args.len() > 1 {
                    let path = &args[1];
                    if is_openable_file(path) && std::path::Path::new(path).is_file() {
                        eprintln!("File association launch: {}", path);
                        pending = Some(path.clone());
                    }
                }
            }

            // Android: check the launching intent for a data URI
            #[cfg(target_os = "android")]
            if pending.is_none() {
                if let Some(uri) = android_get_intent_data() {
                    pending = Some(uri);
                }
            }

            // Clone before moving into managed state (needed for Android re-emit)
            #[cfg(target_os = "android")]
            let android_pending = pending.clone();

            app.manage(PendingFile(Mutex::new(pending)));

            // Android: emit open-file events with delays for the JS listener
            // (RunEvent::Opened is not available on Android)
            #[cfg(target_os = "android")]
            {
                if let Some(uri) = android_pending {
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        for delay_ms in [500, 1500, 3000] {
                            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                            eprintln!("[file-assoc] Android re-emit open-file after {}ms", delay_ms);
                            let _ = handle.emit_to("main", "open-file", &uri);
                        }
                    });
                }
            }

            // ── Desktop: show splash then transition to main window ───
            #[cfg(not(target_os = "ios"))]
            #[cfg(not(target_os = "android"))]
            {
                let splash = app.get_webview_window("splashscreen");
                let main_window = app.get_webview_window("main");

                std::thread::spawn(move || {
                    // Brief splash display — no backend to wait for
                    std::thread::sleep(std::time::Duration::from_millis(500));

                    if let Some(main) = main_window {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                    if let Some(sp) = splash {
                        let _ = sp.close();
                    }
                    // Mark app as ready — subsequent file opens go to new windows
                    APP_READY.store(true, Ordering::Release);
                });
            }

            Ok(())
        });

    // (v5.21: the Window-menu click handler and the Destroyed-event menu
    // rebuild are gone with the Window menu itself.)

    let app = builder
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            let msg = format!("FATAL: Failed to build Tauri app: {}", e);
            eprintln!("{}", msg);
            let _ = std::fs::write("/tmp/scriptcraft_crash.log", &msg);
            panic!("{}", msg);
        });

    app.run(|_app_handle, _event| {
        // ── Handle file association open events (macOS + iOS) ──────
        // Note: Android does NOT support RunEvent::Opened — intent data is
        // handled in setup() via android_get_intent_data() instead.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &_event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let mut path_str = path.to_string_lossy().to_string();
                    if !is_openable_file(&path_str) {
                        continue;
                    }

                    // On iOS, copy the file to the app's temp directory using
                    // security-scoped access. Files from the Files app require
                    // startAccessingSecurityScopedResource before reading/copying.
                    // Files from WhatsApp etc. land in Documents/Inbox (already
                    // in sandbox) so the copy succeeds either way.
                    #[cfg(target_os = "ios")]
                    {
                        let temp_dir = std::env::temp_dir();
                        let fname = path.file_name().unwrap_or_default();
                        let temp_path = temp_dir.join(fname);
                        let c_src = std::ffi::CString::new(path_str.as_bytes()).ok();
                        let c_dst = std::ffi::CString::new(temp_path.to_string_lossy().as_bytes()).ok();
                        let copied = match (c_src, c_dst) {
                            (Some(src), Some(dst)) => unsafe {
                                ios_copy_file_scoped(src.as_ptr(), dst.as_ptr()) == 1
                            },
                            _ => false,
                        };
                        if copied {
                            eprintln!("[file-assoc] iOS: copied to sandbox temp: {}", temp_path.display());
                            path_str = temp_path.to_string_lossy().to_string();
                        } else {
                            eprintln!("[file-assoc] iOS: scoped copy failed, trying std::fs::copy");
                            match std::fs::copy(&path, &temp_path) {
                                Ok(_) => {
                                    eprintln!("[file-assoc] iOS: std::fs::copy succeeded: {}", temp_path.display());
                                    path_str = temp_path.to_string_lossy().to_string();
                                }
                                Err(e) => {
                                    eprintln!("[file-assoc] iOS: all copy attempts failed ({}), using original", e);
                                }
                            }
                        }
                    }

                    eprintln!("[file-assoc] RunEvent::Opened: {}", path_str);

                    // Desktop warm start: open file in a new window
                    #[cfg(desktop)]
                    if APP_READY.load(Ordering::Acquire) {
                        eprintln!("[file-assoc] App already running — opening in new window");
                        let count = WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed);
                        let label = format!("main-{}", count);
                        let url = tauri::WebviewUrl::App("/".into());
                        match tauri::WebviewWindowBuilder::new(_app_handle, &label, url)
                            .title("ScriptCraft")
                            .inner_size(1280.0, 800.0)
                            .min_inner_size(800.0, 600.0)
                            .resizable(true)
                            .maximized(true)
                            .build()
                        {
                            Ok(_new_win) => {
                                // Use emit_to with the label to target ONLY the new window.
                                // WebviewWindow::emit() broadcasts to all windows.
                                let handle = _app_handle.clone();
                                let target_label = label.clone();
                                let path_for_emit = path_str.clone();
                                std::thread::spawn(move || {
                                    for delay_ms in [500, 1500, 3000] {
                                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                                        let _ = handle.emit_to(&target_label, "open-file", &path_for_emit);
                                    }
                                });
                                continue; // skip the old broadcast path
                            }
                            Err(e) => {
                                eprintln!("[file-assoc] Failed to create new window: {}", e);
                                // Fall through to old behavior
                            }
                        }
                    }

                    // Cold start / iOS / fallback: load into the main window
                    // Store in pending state so frontend can retrieve it
                    if let Some(state) = _app_handle.try_state::<PendingFile>() {
                        *state.0.lock().unwrap() = Some(path_str.clone());
                    }

                    // Emit to the main window only (not all windows)
                    let _ = _app_handle.emit_to("main", "open-file", &path_str);

                    // Re-emit after delays to handle cold-start timing
                    // The WebView may not have loaded JS listeners yet
                    let handle = _app_handle.clone();
                    let path_for_retry = path_str.clone();
                    std::thread::spawn(move || {
                        for delay_ms in [500, 1500, 3000] {
                            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                            eprintln!("[file-assoc] re-emit open-file after {}ms", delay_ms);
                            let _ = handle.emit_to("main", "open-file", &path_for_retry);
                        }
                    });
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::is_blocked_ip;
    use std::net::IpAddr;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn blocks_internal_v4() {
        // loopback, RFC1918, link-local (incl. cloud metadata), CGNAT, 0.0.0.0
        for s in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.5.4",
            "192.168.1.1",
            "169.254.169.254", // AWS/GCP/Azure metadata
            "100.64.0.1",      // carrier-grade NAT
            "0.0.0.0",
        ] {
            assert!(is_blocked_ip(ip(s)), "{s} should be blocked");
        }
    }

    #[test]
    fn blocks_internal_v6() {
        for s in ["::1", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1"] {
            assert!(is_blocked_ip(ip(s)), "{s} should be blocked");
        }
    }

    #[test]
    fn allows_public() {
        for s in ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"] {
            assert!(!is_blocked_ip(ip(s)), "{s} should be allowed");
        }
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp() {
        let dir = std::env::temp_dir().join(format!("sc-atomic-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let target = dir.join("doc.script");
        let ts = target.to_string_lossy().to_string();

        super::atomic_write(&ts, b"first").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "first");

        // A second write replaces the whole file, never partially.
        super::atomic_write(&ts, b"second, longer contents").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "second, longer contents");

        // No sibling temp files are left behind.
        let temps = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .count();
        assert_eq!(temps, 0, "{temps} temp file(s) left behind");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
