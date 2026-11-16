// th-a2f-blendshapes (talking-head a2f-keys): Audio2Face-3D (regression model, e.g. Mark v2.3) run
// offline over a 16 kHz mono wav through the SDK's blendshape-solve executor bundle, one row of
// ARKit-style skin blendshape weights per frame at the requested rate, written as CSV:
//   frame,t,<pose name>,<pose name>,...
// Built inside the SDK tree as a sample (th/rig/a2f_sdk/Dockerfile). No emotion model (Audio2Emotion
// is gated): the emotion input is the neutral (all-zero) vector, as the SDK samples' default.
//
//   th-a2f-blendshapes <model.json> <in-16k.wav> <out.csv> [fps=30]
#include "audio2face/audio2face.h"
#include "audio2x/cuda_utils.h"

#include "AudioFile.h"

#include <cstdio>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#define CHECK_RESULT(func)                                                                      \
  {                                                                                             \
    std::error_code error = (func);                                                             \
    if (error) {                                                                                \
      std::cerr << "th-a2f: line " << __LINE__ << ": " << #func << ": " << error.message() << std::endl; \
      return 1;                                                                                 \
    }                                                                                           \
  }

struct Destroyer {
  template <typename T> void operator()(T* obj) const { obj->Destroy(); }
};
template <typename T> using UniquePtr = std::unique_ptr<T, Destroyer>;

struct Collected {
  std::mutex lock;
  std::map<long long, std::vector<float>> frames;  // by timestamp
  bool failed = false;
};

int main(int argc, char** argv) {
  if (argc < 4) {
    std::cerr << "usage: th-a2f-blendshapes <model.json> <in-16k.wav> <out.csv> [fps=30]" << std::endl;
    return 2;
  }
  const char* model = argv[1];
  const char* wav = argv[2];
  const char* out = argv[3];
  const std::size_t fps = argc > 4 ? std::stoul(argv[4]) : 30;

  AudioFile<float> audio;
  if (!audio.load(wav) || audio.getSampleRate() != 16000 || audio.samples.empty()) {
    std::cerr << "th-a2f: " << wav << " must be a readable 16 kHz wav" << std::endl;
    return 1;
  }
  const std::vector<float>& samples = audio.samples[0];

  CHECK_RESULT(nva2x::SetCudaDeviceIfNeeded(0));
  auto bundle = UniquePtr<nva2f::IBlendshapeExecutorBundle>(nva2f::ReadRegressionBlendshapeSolveExecutorBundle(
      1, model, nva2f::IGeometryExecutor::ExecutionOption::SkinTongue, false, fps, 1, nullptr, nullptr));
  if (!bundle) {
    std::cerr << "th-a2f: could not read the bundle " << model << std::endl;
    return 1;
  }
  auto& executor = bundle->GetExecutor();
  if (executor.GetResultType() != nva2f::IBlendshapeExecutor::ResultsType::HOST) {
    std::cerr << "th-a2f: expected host results from the CPU solver" << std::endl;
    return 1;
  }

  nva2f::IBlendshapeSolver* skin = nullptr;
  nva2f::IBlendshapeSolver* tongue = nullptr;
  CHECK_RESULT(nva2f::GetExecutorSkinSolver(executor, 0, &skin));
  CHECK_RESULT(nva2f::GetExecutorTongueSolver(executor, 0, &tongue));
  std::vector<std::string> names;
  for (int i = 0; i < skin->NumBlendshapePoses(); ++i) names.emplace_back(skin->GetPoseName(i));
  for (int i = 0; tongue != nullptr && i < tongue->NumBlendshapePoses(); ++i) names.emplace_back(std::string("tongue:") + tongue->GetPoseName(i));
  const std::size_t count = executor.GetWeightCount();
  std::cerr << "th-a2f: " << names.size() << " named poses, " << count << " weights per frame, " << samples.size() << " samples" << std::endl;

  Collected got;
  auto callback = [](void* userdata, const nva2f::IBlendshapeExecutor::HostResults& results, std::error_code error) {
    auto& data = *static_cast<Collected*>(userdata);
    std::lock_guard<std::mutex> guard(data.lock);
    if (error) {
      data.failed = true;
      return;
    }
    data.frames[static_cast<long long>(results.timeStampCurrentFrame)] =
        std::vector<float>(results.weights.Data(), results.weights.Data() + results.weights.Size());
  };
  CHECK_RESULT(executor.SetResultsCallback(callback, &got));

  // Neutral emotion over the whole clip, then all the audio, closed: an offline run.
  auto& emotions = bundle->GetEmotionAccumulator(0);
  std::vector<float> neutral(emotions.GetEmotionSize(), 0.0f);
  CHECK_RESULT(emotions.Accumulate(0, nva2x::HostTensorFloatConstView{neutral.data(), neutral.size()}, bundle->GetCudaStream().Data()));
  CHECK_RESULT(emotions.Close());
  CHECK_RESULT(bundle->GetAudioAccumulator(0).Accumulate(nva2x::HostTensorFloatConstView{samples.data(), samples.size()}, bundle->GetCudaStream().Data()));
  CHECK_RESULT(bundle->GetAudioAccumulator(0).Close());
  while (nva2x::GetNbReadyTracks(executor) > 0) CHECK_RESULT(executor.Execute(nullptr));
  CHECK_RESULT(executor.Wait(0));
  if (got.failed) {
    std::cerr << "th-a2f: the solver reported an error" << std::endl;
    return 1;
  }

  FILE* f = std::fopen(out, "w");
  if (f == nullptr) {
    std::cerr << "th-a2f: cannot write " << out << std::endl;
    return 1;
  }
  std::fprintf(f, "frame,t");
  for (std::size_t i = 0; i < count; ++i) std::fprintf(f, ",%s", i < names.size() ? names[i].c_str() : ("w" + std::to_string(i)).c_str());
  std::fprintf(f, "\n");
  std::size_t index = 0;
  for (const auto& [stamp, weights] : got.frames) {
    std::fprintf(f, "%zu,%lld", index++, stamp);
    for (float w : weights) std::fprintf(f, ",%.6f", w);
    std::fprintf(f, "\n");
  }
  std::fclose(f);
  std::cerr << "th-a2f: " << got.frames.size() << " frames -> " << out << std::endl;
  return 0;
}
