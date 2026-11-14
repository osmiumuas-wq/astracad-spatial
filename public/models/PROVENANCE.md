# Shipped models

`Xenova/whisper-tiny.en/` holds OpenAI's Whisper tiny (English) speech recogniser, converted to ONNX and quantised to
8 bits by Xenova (Joshua Lochner) for transformers.js. Downloaded unchanged from
https://huggingface.co/Xenova/whisper-tiny.en (files: config, generation config, preprocessor config, tokenizer,
tokenizer config, `onnx/encoder_model_quantized.onnx`, `onnx/decoder_model_merged_quantized.onnx`).
Whisper is released by OpenAI under the MIT licence.

`../ort/` holds the ONNX Runtime Web WebAssembly build that ships inside `@huggingface/transformers` 3.8.1
(`dist/ort-wasm-simd-threaded.jsep.*`), MIT licence, copied unchanged so speech recognition needs no CDN.
