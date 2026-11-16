# talking-head a2f-keys: NVIDIA Audio2Face-3D SDK (MIT) built on Linux with the CUDA 12.9 toolkit and
# TensorRT 10.13 (the SDK wants CUDA >= 12.8 < 13 and TensorRT >= 10.13 < 11; this box's Windows
# toolkit is 12.4), plus th-a2f-blendshapes (main.cpp): wav -> per-frame blendshape weights CSV.
# Weights are NOT in the image: they are bind-mounted from $TH_HOME/models/a2f-keys, and the TensorRT
# engine is built from network.onnx by this image's trtexec (an engine is tied to its TensorRT).
#
#   docker build -t th-a2f-sdk:1ca0f02 tools/talking-head/th/rig/a2f_sdk     (th fetch a2f-keys)
FROM nvidia/cuda:12.9.1-devel-ubuntu22.04

ARG TRT_VERSION=10.13.3.9-1+cuda12.9
ARG SDK_REPO=https://github.com/NVIDIA/Audio2Face-3D-SDK
ARG SDK_REV=1ca0f02535ed774f5dbcd724a31cd486368dc783

# TensorRT from the CUDA apt repo, every libnvinfer/onnxparser package pinned to one version.
RUN printf 'Package: libnvinfer* libnvonnxparsers* tensorrt* python3-libnvinfer*\nPin: version %s\nPin-Priority: 1001\n' "$TRT_VERSION" \
      > /etc/apt/preferences.d/tensorrt \
 && apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git ca-certificates curl python3 \
      libnvinfer-dev libnvinfer-headers-dev libnvinfer-plugin-dev libnvinfer-headers-plugin-dev \
      libnvonnxparsers-dev libnvinfer-bin \
 && rm -rf /var/lib/apt/lists/*

RUN git clone "$SDK_REPO" /opt/sdk && git -C /opt/sdk checkout --quiet "$SDK_REV"
WORKDIR /opt/sdk
RUN ./fetch_deps.sh release

COPY main.cpp CMakeLists.txt /opt/sdk/audio2face-sdk/source/samples/th-a2f-blendshapes/
RUN echo 'add_subdirectory(th-a2f-blendshapes)' >> audio2face-sdk/source/samples/CMakeLists.txt \
 && export PATH="$PATH:/opt/sdk/_deps/build-deps/ninja" \
 && _deps/build-deps/cmake/bin/cmake -B _build/release -G Ninja -S . -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_CUDA_ARCHITECTURES=89 \
 && _deps/build-deps/cmake/bin/cmake --build _build/release --target th-a2f-blendshapes --parallel \
 && exe="$(find _build/release -type f -name th-a2f-blendshapes | head -1)" \
 && mkdir -p /opt/a2f/bin /opt/a2f/lib \
 && cp "$exe" /opt/a2f/bin/ \
 && find _build/release -name '*.so*' -exec cp -a {} /opt/a2f/lib/ \;

ENV LD_LIBRARY_PATH=/opt/a2f/lib:${LD_LIBRARY_PATH}
ENV PATH=/opt/a2f/bin:/usr/src/tensorrt/bin:${PATH}
WORKDIR /work
