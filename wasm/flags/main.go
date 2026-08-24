package main

import (
	_ "embed"
	"syscall/js"
)

//go:embed flags.json
var raw []byte

func main() {
	js.Global().Set("__getFlags", js.FuncOf(func(this js.Value, args []js.Value) any {
		return string(raw)
	}))
	select {}
}
