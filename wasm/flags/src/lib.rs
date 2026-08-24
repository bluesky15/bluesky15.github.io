#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

static FLAGS_JSON: &[u8] = include_bytes!("../flags.json");

#[no_mangle]
pub extern "C" fn get_flags_ptr() -> *const u8 {
    FLAGS_JSON.as_ptr()
}

#[no_mangle]
pub extern "C" fn get_flags_len() -> usize {
    FLAGS_JSON.len()
}
