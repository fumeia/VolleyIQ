package com.volleyiq.app

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.OpenableColumns
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.volleyiq.app.work.AiCheckWorker
import com.volleyiq.app.work.AnalysisWorker
import com.volleyiq.app.work.ImportWorker
import com.volleyiq.app.work.UpdateWorker
import com.volleyiq.app.work.UploadWorker
import com.volleyiq.app.work.VideoUploadWorker
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Bridge between the web UI and the phone: video files, link imports, background analysis. */
@CapacitorPlugin(
    name = "VolleyIQ",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class VolleyIQPlugin : Plugin() {

    private val work get() = WorkManager.getInstance(context)

    @PluginMethod
    fun pickVideo(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "video/*"
        }
        startActivityForResult(call, intent, "onVideoPicked")
    }

    @ActivityCallback
    private fun onVideoPicked(call: PluginCall, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            call.reject("No video selected", "CANCELLED")
            return
        }
        // Keep access after a restart, so the match can be reopened with the same file.
        runCatching { context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        call.resolve(describe(uri))
    }

    /** Checks that a stored video (content:// or file path) is still readable. */
    /**
     * Print (or "Save as PDF") the page as it is now, with its print styles: the WebView has no
     * window.print(), so this hands the page to Android's print service.
     */
    @PluginMethod
    fun print(call: PluginCall) {
        val name = call.getString("name")?.takeIf { it.isNotBlank() } ?: "VolleyIQ report"
        activity.runOnUiThread {
            try {
                val manager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
                val attrs = PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build()
                manager.print(name, bridge.webView.createPrintDocumentAdapter(name), attrs)
                call.resolve()
            } catch (e: Exception) {
                call.reject(e.message ?: "Printing is not available")
            }
        }
    }

    @PluginMethod
    fun checkVideo(call: PluginCall) {
        val uri = parse(call.getString("uri") ?: return call.reject("uri required"))
        val ok = runCatching { context.contentResolver.openFileDescriptor(uri, "r")?.close(); true }.getOrDefault(false)
        call.resolve(JSObject().put("ok", ok))
    }

    @PluginMethod
    fun importLink(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url required")
        val request = OneTimeWorkRequestBuilder<ImportWorker>()
            .setInputData(workDataOf(ImportWorker.KEY_URL to url))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .addTag("import")
            .build()
        work.enqueue(request)
        call.resolve(JSObject().put("id", request.id.toString()))
    }

    @PluginMethod
    fun analyze(call: PluginCall) {
        val matchId = call.getInt("matchId")?.toLong() ?: return call.reject("matchId required")
        val uri = call.getString("uri") ?: return call.reject("uri required")
        val apiBase = call.getString("apiBase") ?: return call.reject("apiBase required")
        val roster = call.getArray("roster")?.toList<Any>()?.map { (it as Number).toInt() }?.toIntArray() ?: IntArray(0)
        val points = call.getArray("points")?.toList<Any>()?.map { (it as Number).toDouble() }?.toDoubleArray()

        val analysis = OneTimeWorkRequestBuilder<AnalysisWorker>()
            .setInputData(
                workDataOf(
                    AnalysisWorker.KEY_MATCH to matchId,
                    AnalysisWorker.KEY_URI to uri,
                    AnalysisWorker.KEY_ROSTER to roster,
                    AnalysisWorker.KEY_JERSEYS to (call.getBoolean("readJerseys") ?: true),
                    AnalysisWorker.KEY_CUTS to (call.getBoolean("detectCuts") ?: true),
                    AnalysisWorker.KEY_SENSITIVITY to (call.getDouble("sensitivity") ?: 1.0),
                    AnalysisWorker.KEY_OUR_HALF to call.getString("ourHalf"),
                    AnalysisWorker.KEY_POINTS to points,
                    AnalysisWorker.KEY_SEGMENTS to call.getArray("segments")?.toString(),
                ),
            )
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .addTag("analysis-$matchId")
            .build()
        val upload = OneTimeWorkRequestBuilder<UploadWorker>()
            .setInputData(
                workDataOf(
                    AnalysisWorker.KEY_MATCH to matchId,
                    UploadWorker.KEY_API to apiBase,
                    UploadWorker.KEY_TOKEN to call.getString("token"),
                ),
            )
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .addTag("analysis-$matchId")
            .build()
        work.beginUniqueWork("analysis-$matchId", ExistingWorkPolicy.REPLACE, analysis).then(upload).enqueue()
        call.resolve(JSObject().put("id", analysis.id.toString()).put("uploadId", upload.id.toString()))
    }

    /** State of the analysis (and its upload) for a match, for the progress UI. */
    @PluginMethod
    fun analysisStatus(call: PluginCall) {
        val matchId = call.getInt("matchId") ?: return call.reject("matchId required")
        val infos = work.getWorkInfosForUniqueWork("analysis-$matchId").get()
        val analysis = infos.firstOrNull { it.tags.any { t -> t.endsWith("AnalysisWorker") } }
        val upload = infos.firstOrNull { it.tags.any { t -> t.endsWith("UploadWorker") } }
        call.resolve(
            JSObject()
                .put("analysis", analysis?.let(::toJs))
                .put("upload", upload?.let(::toJs)),
        )
    }

    @PluginMethod
    fun workStatus(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val info = work.getWorkInfoById(UUID.fromString(id)).get()
        call.resolve(JSObject().put("work", info?.let(::toJs)))
    }

    /** The AI check of every rally in the background ([job]: JSON, see AiCheckWorker). */
    @PluginMethod
    fun aiCheckAll(call: PluginCall) {
        val matchId = call.getInt("matchId") ?: return call.reject("matchId required")
        val job = call.getString("job") ?: return call.reject("job required")
        val file = File(context.filesDir, "aicheck-$matchId.json").apply { writeText(job) }
        val request = OneTimeWorkRequestBuilder<AiCheckWorker>()
            .setInputData(workDataOf(AiCheckWorker.KEY_JOB to file.absolutePath))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .addTag("aicheck-$matchId")
            .build()
        work.enqueueUniqueWork("aicheck-$matchId", ExistingWorkPolicy.REPLACE, request)
        call.resolve(JSObject().put("id", request.id.toString()))
    }

    @PluginMethod
    fun aiCheckStatus(call: PluginCall) {
        val matchId = call.getInt("matchId") ?: return call.reject("matchId required")
        val info = work.getWorkInfosForUniqueWork("aicheck-$matchId").get().firstOrNull()
        call.resolve(JSObject().put("work", info?.let(::toJs)))
    }

    @PluginMethod
    fun cancelAiCheck(call: PluginCall) {
        val matchId = call.getInt("matchId") ?: return call.reject("matchId required")
        work.cancelUniqueWork("aicheck-$matchId")
        call.resolve()
    }

    /** Upload the match video into the team's bucket in the background (resumes after a break). */
    @PluginMethod
    fun uploadVideo(call: PluginCall) {
        val matchId = call.getInt("matchId")?.toLong() ?: return call.reject("matchId required")
        val uri = call.getString("uri") ?: return call.reject("uri required")
        val request = OneTimeWorkRequestBuilder<VideoUploadWorker>()
            .setInputData(workDataOf(
                VideoUploadWorker.KEY_MATCH to matchId, VideoUploadWorker.KEY_URI to uri,
                UploadWorker.KEY_API to call.getString("apiBase"), UploadWorker.KEY_TOKEN to call.getString("token"),
            ))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .addTag("video-$matchId")
            .build()
        work.enqueueUniqueWork("video-$matchId", ExistingWorkPolicy.KEEP, request)
        call.resolve()
    }

    @PluginMethod
    fun videoUploadStatus(call: PluginCall) {
        val matchId = call.getInt("matchId") ?: return call.reject("matchId required")
        val info = work.getWorkInfosForUniqueWork("video-$matchId").get().firstOrNull()
        call.resolve(JSObject().put("work", info?.let(::toJs)))
    }

    @PluginMethod
    fun cancelVideoUpload(call: PluginCall) {
        val matchId = call.getInt("matchId") ?: return call.reject("matchId required")
        work.cancelUniqueWork("video-$matchId")
        call.resolve()
    }

    @PluginMethod
    fun cancelAnalysis(call: PluginCall) {
        val matchId = call.getInt("matchId") ?: return call.reject("matchId required")
        work.cancelUniqueWork("analysis-$matchId")
        call.resolve()
    }

    @PluginMethod
    fun cancelWork(call: PluginCall) {
        call.getString("id")?.let { work.cancelWorkById(UUID.fromString(it)) }
        call.resolve()
    }

    /** Deletes an imported video (only files in the app's own folder). */
    @PluginMethod
    fun deleteVideo(call: PluginCall) {
        val path = parse(call.getString("uri") ?: return call.reject("uri required")).path ?: return call.resolve()
        val dir = ImportWorker.videoDir(context).canonicalPath
        val file = File(path)
        if (file.canonicalPath.startsWith(dir)) file.delete()
        call.resolve()
    }

    @PluginMethod
    fun requestNotifications(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
        } else {
            requestPermissionForAlias("notifications", call, "onNotificationPermission")
        }
    }

    @PermissionCallback
    private fun onNotificationPermission(call: PluginCall) {
        call.resolve(JSObject().put("granted", getPermissionState("notifications") == PermissionState.GRANTED))
    }

    private fun toJs(info: WorkInfo): JSObject {
        val data = if (info.state.isFinished) info.outputData else info.progress
        val js = JSObject()
            .put("id", info.id.toString())
            .put("state", info.state.name.lowercase())
            .put("progress", data.getDouble(AnalysisWorker.KEY_PROGRESS, if (info.state == WorkInfo.State.SUCCEEDED) 1.0 else 0.0))
            .put("message", data.getString(AnalysisWorker.KEY_MESSAGE))
            .put("error", data.getString(AnalysisWorker.KEY_ERROR))
        data.getString(ImportWorker.KEY_PATH)?.let { js.put("uri", Uri.fromFile(File(it)).toString()).put("name", data.getString(ImportWorker.KEY_NAME)) }
        if (data.keyValueMap.containsKey(AnalysisWorker.KEY_COUNT)) js.put("count", data.getInt(AnalysisWorker.KEY_COUNT, 0))
        return js
    }

    private fun describe(uri: Uri): JSObject {
        var name = uri.lastPathSegment ?: "video"
        var size = 0L
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getString(0)?.let { name = it }
                size = c.getLong(1)
            }
        }
        val duration = runCatching {
            MediaMetadataRetriever().run {
                setDataSource(context, uri)
                val d = extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
                release()
                d
            }
        }.getOrDefault(0L)
        return JSObject().put("uri", uri.toString()).put("name", name).put("size", size).put("durationMs", duration)
    }

    /** The installed app: version name (e.g. 1.0.1 or 1.0.1-dev.86), build number, device. */
    @PluginMethod
    fun appInfo(call: PluginCall) {
        val pm = context.packageManager
        val info = pm.getPackageInfo(context.packageName, 0)
        call.resolve(JSObject().apply {
            put("version", info.versionName ?: "?")
            put("build", if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong())
            put("android", Build.VERSION.RELEASE)
            put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("canInstall", if (Build.VERSION.SDK_INT >= 26) pm.canRequestPackageInstalls() else true)
        })
    }

    /**
     * Downloads a newer APK from the server ([url], with the login [token]) and opens
     * Android's installer for it. Progress goes out as "updateProgress" events. Without
     * the "install unknown apps" permission it opens that setting instead.
     */
    @PluginMethod
    fun installUpdate(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("url required")
        val token = call.getString("token")
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
            return call.reject("Allow VolleyIQ to install apps, then tap Update again", "NEEDS_PERMISSION")
        }
        // A background job (goes on in other apps, with a progress notification); this call
        // follows it while the app is open and opens the installer when it is done.
        val request = OneTimeWorkRequestBuilder<UpdateWorker>()
            .setInputData(workDataOf(UpdateWorker.KEY_URL to url, UpdateWorker.KEY_TOKEN to token))
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .addTag("update")
            .build()
        // Already downloading (e.g. the About page was reopened): follow that download.
        val running = work.getWorkInfosForUniqueWork("app-update").get().firstOrNull { !it.state.isFinished }
        val id = running?.id ?: request.id.also { work.enqueueUniqueWork("app-update", ExistingWorkPolicy.REPLACE, request) }
        Thread {
            try {
                while (true) {
                    Thread.sleep(500)
                    val info = work.getWorkInfoById(id).get() ?: continue
                    when (info.state) {
                        WorkInfo.State.SUCCEEDED -> {
                            val file = UpdateWorker.apkFile(context)
                            activity.runOnUiThread { activity.startActivity(UpdateWorker.installIntent(context, file)) }
                            return@Thread call.resolve()
                        }
                        WorkInfo.State.FAILED, WorkInfo.State.CANCELLED ->
                            return@Thread call.reject(info.outputData.getString(AnalysisWorker.KEY_ERROR) ?: "Download failed")
                        else -> {
                            val p = info.progress
                            if (p.keyValueMap.containsKey(UpdateWorker.KEY_DONE)) {
                                notifyListeners("updateProgress", JSObject().apply {
                                    put("done", p.getLong(UpdateWorker.KEY_DONE, 0)); put("total", p.getLong(UpdateWorker.KEY_TOTAL, -1))
                                })
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                call.reject(e.message ?: "Download failed")
            }
        }.start()
    }

    private fun parse(s: String): Uri = if (s.startsWith("/")) Uri.fromFile(File(s)) else Uri.parse(s)
}
