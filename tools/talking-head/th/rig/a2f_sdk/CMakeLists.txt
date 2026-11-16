# th-a2f-blendshapes: added to the SDK's samples by th/rig/a2f_sdk/Dockerfile (talking-head a2f-keys).
add_executable(th-a2f-blendshapes)
set_target_properties(th-a2f-blendshapes PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${A2F_BINARY_DIR}/bin)
target_sources(th-a2f-blendshapes PRIVATE main.cpp)
target_link_libraries(th-a2f-blendshapes PRIVATE audio2x AudioFile::AudioFile)
