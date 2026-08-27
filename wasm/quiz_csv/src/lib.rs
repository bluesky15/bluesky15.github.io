//! WASM module that converts quiz_csv_1.csv -> JSON
//! Embedded CSV is compiled into the binary; JSON is generated at runtime
//! via pure Rust CSV parsing (handles quoted commas) and exposed via
//! ptr/len exports. Also provides a generic convert function.

static CSV_BYTES: &[u8] = include_bytes!("../quiz_csv_1.csv");

// Bump-allocated output buffer for generic convert call
static mut OUT_BUF: Vec<u8> = Vec::new();
static mut OUT_LEN: usize = 0;

// Cached JSON for the embedded CSV (computed on first access)
static mut CACHED_JSON: Option<Vec<u8>> = None;

fn escape_json(s: &str, out: &mut Vec<u8>) {
    out.push(b'"');
    for c in s.bytes() {
        match c {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            0x08 => out.extend_from_slice(b"\\b"),
            0x0C => out.extend_from_slice(b"\\f"),
            c if c < 0x20 => {
                let hex = b"0123456789abcdef";
                out.extend_from_slice(b"\\u00");
                out.push(hex[(c >> 4) as usize]);
                out.push(hex[(c & 0xF) as usize]);
            }
            _ => out.push(c),
        }
    }
    out.push(b'"');
}

// Minimal CSV parser: handles RFC4180 quoted fields, embedded commas, double-quote escaping
fn parse_csv(csv: &[u8]) -> Vec<Vec<String>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut cur_row: Vec<String> = Vec::new();
    let mut cur_field = Vec::<u8>::new();
    let mut in_quotes = false;
    let mut i = 0;
    while i < csv.len() {
        let b = csv[i];
        if in_quotes {
            if b == b'"' {
                if i + 1 < csv.len() && csv[i + 1] == b'"' {
                    cur_field.push(b'"');
                    i += 2;
                    continue;
                } else {
                    in_quotes = false;
                    i += 1;
                    continue;
                }
            } else {
                cur_field.push(b);
                i += 1;
                continue;
            }
        } else {
            if b == b'"' {
                in_quotes = true;
                i += 1;
                continue;
            } else if b == b',' {
                cur_row.push(String::from_utf8(cur_field.clone()).unwrap_or_default());
                cur_field.clear();
                i += 1;
                continue;
            } else if b == b'\r' {
                // skip \r, handle \n as row terminator
                i += 1;
                continue;
            } else if b == b'\n' {
                cur_row.push(String::from_utf8(cur_field.clone()).unwrap_or_default());
                cur_field.clear();
                // avoid pushing empty trailing row (e.g. final newline)
                let is_empty = cur_row.len() == 1 && cur_row[0].is_empty();
                if !is_empty {
                    rows.push(core::mem::take(&mut cur_row));
                } else {
                    cur_row.clear();
                }
                i += 1;
                continue;
            } else {
                cur_field.push(b);
                i += 1;
                continue;
            }
        }
    }
    // flush last field/row if no trailing newline
    if !cur_field.is_empty() || !cur_row.is_empty() {
        cur_row.push(String::from_utf8(cur_field).unwrap_or_default());
        rows.push(cur_row);
    }
    rows
}

fn csv_to_json_bytes(csv: &[u8]) -> Vec<u8> {
    let rows = parse_csv(csv);
    if rows.is_empty() {
        return b"[]".to_vec();
    }
    let header = &rows[0];
    // expect: quiz_id,position,question,option_1,option_2,option_3,option_4,correct_index,correct_answer
    let mut out: Vec<u8> = Vec::with_capacity(csv.len() * 2);
    out.push(b'[');
    let mut first = true;
    for row in rows.iter().skip(1) {
        if row.len() < header.len() {
            continue;
        }
        // build map
        let quiz_id = &row[0];
        let position: usize = row[1].parse().unwrap_or(0);
        let question = &row[2];
        let o1 = &row[3];
        let o2 = &row[4];
        let o3 = &row[5];
        let o4 = &row[6];
        let correct_index: usize = row[7].parse().unwrap_or(0);
        let correct_answer = &row[8];
        if !first {
            out.push(b',');
        }
        first = false;
        out.extend_from_slice(b"{\"quiz_id\":");
        escape_json(quiz_id, &mut out);
        out.extend_from_slice(b",\"position\":");
        out.extend_from_slice(position.to_string().as_bytes());
        out.extend_from_slice(b",\"question\":");
        escape_json(question, &mut out);
        out.extend_from_slice(b",\"options\":[");
        escape_json(o1, &mut out);
        out.push(b',');
        escape_json(o2, &mut out);
        out.push(b',');
        escape_json(o3, &mut out);
        out.push(b',');
        escape_json(o4, &mut out);
        out.extend_from_slice(b"],\"correct_index\":");
        out.extend_from_slice(correct_index.to_string().as_bytes());
        out.extend_from_slice(b",\"correct_answer\":");
        escape_json(correct_answer, &mut out);
        out.push(b'}');
    }
    out.push(b']');
    out
}

fn ensure_cached_json() -> &'static [u8] {
    unsafe {
        if CACHED_JSON.is_none() {
            CACHED_JSON = Some(csv_to_json_bytes(CSV_BYTES));
        }
        CACHED_JSON.as_ref().unwrap().as_slice()
    }
}

// Exports matching flags.wasm pattern + generic converter

#[no_mangle]
pub extern "C" fn get_csv_ptr() -> *const u8 {
    CSV_BYTES.as_ptr()
}

#[no_mangle]
pub extern "C" fn get_csv_len() -> usize {
    CSV_BYTES.len()
}

#[no_mangle]
pub extern "C" fn get_json_ptr() -> *const u8 {
    ensure_cached_json().as_ptr()
}

#[no_mangle]
pub extern "C" fn get_json_len() -> usize {
    ensure_cached_json().len()
}

#[no_mangle]
pub extern "C" fn get_quiz_count() -> usize {
    // header excluded
    let rows = parse_csv(CSV_BYTES);
    if rows.is_empty() { 0 } else { rows.len() - 1 }
}

// Generic converter: caller passes ptr/len of CSV UTF-8, wasm allocates output buffer
// and returns written length. Output can be read via get_out_ptr/get_out_len.
#[no_mangle]
pub extern "C" fn convert_csv_to_json(csv_ptr: *const u8, csv_len: usize) -> usize {
    let slice = unsafe { core::slice::from_raw_parts(csv_ptr, csv_len) };
    let json = csv_to_json_bytes(slice);
    unsafe {
        OUT_BUF = json;
        OUT_LEN = OUT_BUF.len();
        OUT_LEN
    }
}

#[no_mangle]
pub extern "C" fn get_out_ptr() -> *const u8 {
    unsafe { OUT_BUF.as_ptr() }
}

#[no_mangle]
pub extern "C" fn get_out_len() -> usize {
    unsafe { OUT_LEN }
}

// Aliases for ergonomic JS use (also expose as get_flags-style for symmetry)
#[no_mangle]
pub extern "C" fn get_flags_ptr() -> *const u8 {
    get_json_ptr()
}
#[no_mangle]
pub extern "C" fn get_flags_len() -> usize {
    get_json_len()
}
